/// <reference types="jest" />

/**
 * SweeperWorkflow: the state machine that runs every registered removal and then deletes the
 * sweeper itself. Deleting the sweeper while CloudFormation still owns the state machine would leave
 * a live stack without its sweeper, so the self-cleanup tail is entered only after a presence check
 * on the state machine's own logical id; the deletions are ordered so each can be skipped when its
 * target is already gone, and the last one cannot be followed by a state that runs against a deleted machine.
 * The state machine is retained, or the sweep could not finish once the stack is deleted.
 */

import { renderLiteralText, statementsForAction }                        from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                                      from 'aws-cdk-lib/assertions';
import * as iam                                                          from 'aws-cdk-lib/aws-iam';
import * as lambda                                                       from 'aws-cdk-lib/aws-lambda';
import * as sfn                                                          from 'aws-cdk-lib/aws-stepfunctions';
import { App, BootstraplessSynthesizer, Duration, Stack }                from 'aws-cdk-lib';
import * as t                                                            from 'typanion';

import { stateBodyOf }                                                   from '../../../__tests__/state-machine-helpers';
import { isTemplateValue, resourcesOfType }                              from '../../../__tests__/template-resources';
import type { IRemovalChain }                                            from '../../../platform/ops/sweeper/removal';
import { SweeperWorkflow }                                               from '../sweeper-workflow';
import type { SweeperWorkflowProps }                                     from '../sweeper-workflow';

const STATE_MACHINE_ARN = 'arn:aws:states:us-west-2:123456789012:stateMachine:sweeper-machine';

const isStateMachineProperties = t.isPartial({ DefinitionString: isTemplateValue });

describe('SweeperWorkflow', () => {
  /** What the workflow handed to the removals when it built their chains. */
  interface Received {
    readonly retryIntervals: Duration[];
    readonly workers:        lambda.IFunction[];
  }

  interface Synthesized extends Received {
    readonly template:              Template;
    readonly definition:            string;
    readonly stateMachineLogicalId: string;
    readonly worker:                lambda.IFunction;
  }

  /** A removal that contributes one Pass state named `stateName` and records what the workflow handed it. */
  function recordingRemoval(stack: Stack, stateName: string, received: Received): IRemovalChain {
    return {
      buildChain(worker, retryInterval, onSuccess) {
        const state = new sfn.Pass(stack, stateName);
        state.next(onSuccess);
        received.retryIntervals.push(retryInterval);
        received.workers.push(worker);
        return state;
      },
    };
  }

  function synthesize(stackId: string, overrides: Partial<SweeperWorkflowProps> = {}): Synthesized {
    const stack           = new Stack(new App(), stackId, {
      env:         { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const built: Received = { retryIntervals: [], workers: [] };
    const worker          = lambda.Function.fromFunctionArn(stack, 'worker-ref', 'arn:aws:lambda:us-west-2:123456789012:function:sweeper-worker');

    const workflow = new SweeperWorkflow(stack, 'workflow', {
      executionRole:  new iam.Role(stack, 'execution-role', { assumedBy: new iam.ServicePrincipal('states.amazonaws.com') }),
      workerRoleArn:  'arn:aws:iam::123456789012:role/worker-role',
      workerRoleName: 'worker-role',
      worker,
      stateMachineName: 'sweeper-machine',
      stateMachineArn:  STATE_MACHINE_ARN,
      removals:         [recordingRemoval(stack, 'FirstRemoval', built), recordingRemoval(stack, 'SecondRemoval', built)],
      ...overrides,
    });
    const grantee  = new iam.Role(stack, 'grantee', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
    workflow.grantStartExecution(grantee);
    workflow.grantExecutionReaping(grantee);

    const template       = Template.fromStack(stack);
    const [stateMachine] = resourcesOfType(template, 'AWS::StepFunctions::StateMachine', isStateMachineProperties);
    return {
      template,
      definition:            renderLiteralText(stateMachine.properties.DefinitionString),
      stateMachineLogicalId: stateMachine.logicalId,
      worker,
      ...built,
    };
  }

  it('refuses to be built without a removal, because its definition would have nothing to sweep', () => {
    expect(() => synthesize('NoRemovalStack', { removals: [] })).toThrow('SweeperWorkflow requires at least one registered removal');
  });

  describe('definition', () => {
    it('runs the removals in the order given, then the self-cleanup tail', () => {
      const { definition } = synthesize('OrderStack');

      expect(definition).toContain('"StartAt":"FirstRemoval"');
      expect(stateBodyOf(definition, 'FirstRemoval')).toContain('"Next":"SecondRemoval"');
      expect(stateBodyOf(definition, 'SecondRemoval')).toContain('"Next":"SelfCleanupDescribeOwnResource"');
    });

    it('hands every removal the worker and a retry interval of 5 minutes by default, and times out after 4 hours', () => {
      const { definition, retryIntervals, workers, worker } = synthesize('DefaultsStack');

      expect(retryIntervals.map((interval) => interval.toSeconds())).toEqual([300, 300]);
      expect(workers).toHaveLength(2);
      for (const received of workers) {
        expect(received).toBe(worker);
      }
      expect(definition).toContain('"TimeoutSeconds":14400');
    });

    it('hands every removal the retry interval it is given', () => {
      const { retryIntervals } = synthesize('RetryIntervalStack', { retryInterval: Duration.minutes(1) });

      expect(retryIntervals.map((interval) => interval.toSeconds())).toEqual([60, 60]);
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
      expect(deleteStateMachine).toContain('"End":true');
    });
  });

  describe('grants', () => {
    it('lets the grantee start executions of this state machine only', () => {
      const { template } = synthesize('StartExecutionStack');

      const statements = statementsForAction(template, 'states:StartExecution');

      expect(statements).toEqual([{ Action: 'states:StartExecution', Effect: 'Allow', Resource: STATE_MACHINE_ARN }]);
    });

    it('lets the grantee list and stop executions of this state machine only', () => {
      const { template } = synthesize('ReapingStack');

      const statements = statementsForAction(template, 'states:StopExecution');

      expect(statements).toEqual([
        { Action: ['states:ListExecutions', 'states:StopExecution'], Effect: 'Allow', Resource: STATE_MACHINE_ARN },
      ]);
    });
  });

  describe('retention', () => {
    it('keeps the state machine when the stack is deleted, so the sweep can finish after it', () => {
      const { template } = synthesize('RetentionStack');

      const [stateMachine] = resourcesOfType(template, 'AWS::StepFunctions::StateMachine', isStateMachineProperties);

      expect(stateMachine).toMatchObject({ deletionPolicy: 'RetainExceptOnCreate', updateReplacePolicy: 'Retain' });
    });
  });
});
