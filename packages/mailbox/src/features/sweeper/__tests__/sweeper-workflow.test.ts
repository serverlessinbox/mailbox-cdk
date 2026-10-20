/// <reference types="jest" />

/**
 * SweeperWorkflow: the state machine that runs every registered removal and then deletes the
 * sweeper itself. Deleting the sweeper while CloudFormation still owns the state machine would leave
 * a live stack without its sweeper, so the self-cleanup tail is entered only after a presence check
 * on the state machine's own logical id; the deletions are ordered so each can be skipped when its
 * target is already gone, and the last one cannot be followed by a state that runs against a deleted machine.
 */

import { actionsOf, renderLiteralText, statementsOfDocument }        from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                                  from 'aws-cdk-lib/assertions';
import * as iam                                                      from 'aws-cdk-lib/aws-iam';
import { Duration }                                                  from 'aws-cdk-lib';
import { Construct }                                                 from 'constructs';

import { SweeperWorkflow }                                           from '../sweeper-workflow';
import type { SweeperWorkflowProps }                                 from '../sweeper-workflow';

import { newRemovals, newTestStack, newWorkerFunction, stateBodyOf } from './sweeper-helpers';

const STATE_MACHINE_ARN = 'arn:aws:states:us-west-2:123456789012:stateMachine:sweeper-machine';

describe('SweeperWorkflow', () => {
  interface Synthesized {
    readonly template: Template;
    readonly definition: string;
    readonly stateMachineLogicalId: string;
  }

  function synthesize(stackId: string, overrides: Partial<SweeperWorkflowProps> = {}): Synthesized {
    const stack    = newTestStack(stackId);
    const group    = new Construct(stack, 'ops');
    const workflow = new SweeperWorkflow(stack, 'workflow', {
      executionRole: new iam.Role(stack, 'execution-role', { assumedBy: new iam.ServicePrincipal('states.amazonaws.com') }),
      workerRoleArn: 'arn:aws:iam::123456789012:role/worker-role',
      workerRoleName: 'worker-role',
      worker: newWorkerFunction(stack),
      stateMachineName: 'sweeper-machine',
      stateMachineArn: STATE_MACHINE_ARN,
      removals: newRemovals(group),
      ...overrides,
    });
    const grantee  = new iam.Role(stack, 'grantee', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
    workflow.grantStartExecution(grantee);
    workflow.grantExecutionReaping(grantee);
    workflow.markForRetention();

    const template                           = Template.fromStack(stack);
    const [[stateMachineLogicalId, machine]] = Object.entries(template.findResources('AWS::StepFunctions::StateMachine'));
    return { template, definition: renderLiteralText(machine.Properties.DefinitionString), stateMachineLogicalId };
  }

  it('refuses to be built without a removal, because its definition would have nothing to sweep', () => {
    expect(() => synthesize('NoRemovalStack', { removals: [] })).toThrow('SweeperWorkflow requires at least one registered removal');
  });

  describe('definition', () => {
    it('runs the removals in the order given, then the self-cleanup tail', () => {
      const { definition } = synthesize('OrderStack');

      expect(definition).toContain('"StartAt":"CertHasTarget"');
      expect(stateBodyOf(definition, 'CertHasTarget')).toContain('"Default":"EdgeFnHasTarget"');
      expect(stateBodyOf(definition, 'EdgeFnHasTarget')).toContain('"Default":"DetectorHasTarget"');
      expect(stateBodyOf(definition, 'DetectorHasTarget')).toContain('"Default":"SelfCleanupDescribeOwnResource"');
    });

    it('waits 5 minutes between retries and times out after 4 hours by default', () => {
      const { definition } = synthesize('DefaultsStack');

      expect(stateBodyOf(definition, 'CertWaitRetry')).toContain('"Seconds":300');
      expect(definition).toContain('"TimeoutSeconds":14400');
    });

    it('waits the retry interval it is given', () => {
      const { definition } = synthesize('RetryIntervalStack', { retryInterval: Duration.minutes(1) });

      expect(stateBodyOf(definition, 'CertWaitRetry')).toContain('"Seconds":60');
    });
  });

  describe('self-cleanup guard', () => {
    it('describes the state machine\'s own resource in the stack, by its own logical id', () => {
      const { definition, stateMachineLogicalId } = synthesize('GuardDescribeStack');

      const describeOwn = stateBodyOf(definition, 'SelfCleanupDescribeOwnResource');

      expect(describeOwn).toContain('aws-sdk:cloudformation:describeStackResource');
      expect(describeOwn).toContain(`"LogicalResourceId":"${stateMachineLogicalId}"`);
      expect(describeOwn).toContain('"Next":"SelfCleanupGuard"');
    });

    it('ends in Succeed without deleting anything when the resource is still in the template', () => {
      const { definition } = synthesize('GuardPresentStack');

      expect(stateBodyOf(definition, 'SelfCleanupGuard')).toContain('"Default":"Succeed"');
      expect(definition).toContain('"Succeed":{"Type":"Succeed"');
    });

    it('starts the deletions when the describe call answers ValidationError, which CloudFormation raises for a removed logical id', () => {
      const { definition } = synthesize('GuardAbsentStack');

      expect(stateBodyOf(definition, 'SelfCleanupDescribeOwnResource')).toContain('cloudformation.ValidationError');
      expect(stateBodyOf(definition, 'SelfCleanupCaptureNotFound')).toContain('"notFound":true');
      expect(stateBodyOf(definition, 'SelfCleanupCaptureNotFound')).toContain('"Next":"SelfCleanupGuard"');
      const guard = stateBodyOf(definition, 'SelfCleanupGuard');
      expect(guard).toContain('"Variable":"$.selfCheck.notFound"');
      expect(guard).toContain('"Next":"SelfCleanupDeleteWorker"');
    });
  });

  describe('self-cleanup deletions', () => {
    it('deletes the worker, its role policy and role, then the state machine, skipping what is already gone', () => {
      const { definition } = synthesize('DeletionsStack');

      const deleteWorker = stateBodyOf(definition, 'SelfCleanupDeleteWorker');
      expect(deleteWorker).toContain('"Next":"SelfCleanupDeleteWorkerRolePolicy"');
      expect(deleteWorker).toContain('lambda.ResourceNotFoundException');

      const deleteRolePolicy = stateBodyOf(definition, 'SelfCleanupDeleteWorkerRolePolicy');
      expect(deleteRolePolicy).toContain('"RoleName":"worker-role"');
      expect(deleteRolePolicy).toContain('"PolicyName":"sweeper-worker-policy"');
      expect(deleteRolePolicy).toContain('"Next":"SelfCleanupDeleteWorkerRole"');
      expect(deleteRolePolicy).toContain('iam.NoSuchEntityException');

      const deleteRole = stateBodyOf(definition, 'SelfCleanupDeleteWorkerRole');
      expect(deleteRole).toContain('"Next":"SelfCleanupDeleteStateMachine"');
      expect(deleteRole).toContain('iam.DeleteConflictException');
    });

    it('ends with the deletion of the state machine, which no state follows and whose failure still succeeds', () => {
      const { definition } = synthesize('TerminalDeletionStack');

      const deleteStateMachine = stateBodyOf(definition, 'SelfCleanupDeleteStateMachine');

      expect(deleteStateMachine).toContain(`"StateMachineArn":"${STATE_MACHINE_ARN}"`);
      expect(deleteStateMachine).toContain('"ErrorEquals":["States.ALL"]');
      expect(deleteStateMachine).toContain('"Next":"Succeed"');
      expect(deleteStateMachine).not.toMatch(/"Next":"(?!Succeed)/);
      expect(deleteStateMachine).toContain('"End":true');
    });
  });

  describe('grants', () => {
    it('lets the grantee start executions of this state machine only', () => {
      const { template } = synthesize('StartExecutionStack');

      const statements = Object.values(template.findResources('AWS::IAM::Policy'))
        .flatMap((policy) => statementsOfDocument(policy.Properties.PolicyDocument))
        .filter((statement) => actionsOf(statement).includes('states:StartExecution'));

      expect(statements).toEqual([{ Action: 'states:StartExecution', Effect: 'Allow', Resource: STATE_MACHINE_ARN }]);
    });

    it('lets the grantee list and stop executions of this state machine only', () => {
      const { template } = synthesize('ReapingStack');

      const statements = Object.values(template.findResources('AWS::IAM::Policy'))
        .flatMap((policy) => statementsOfDocument(policy.Properties.PolicyDocument))
        .filter((statement) => actionsOf(statement).includes('states:StopExecution'));

      expect(statements).toEqual([
        { Action: ['states:ListExecutions', 'states:StopExecution'], Effect: 'Allow', Resource: STATE_MACHINE_ARN },
      ]);
    });
  });

  describe('retention', () => {
    it('keeps the state machine when the stack is deleted, so the sweep can finish after it', () => {
      const { template } = synthesize('RetentionStack');

      const [machine] = Object.values(template.findResources('AWS::StepFunctions::StateMachine'));

      expect(machine).toMatchObject({ DeletionPolicy: 'RetainExceptOnCreate', UpdateReplacePolicy: 'Retain' });
    });
  });
});
