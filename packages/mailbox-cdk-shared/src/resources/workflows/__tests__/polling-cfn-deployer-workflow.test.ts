/// <reference types="jest" />

/**
 * Pins the state machine that polls a sub-stack deployment. The worker Lambda reads each invocation as
 * an `SfnInvokeEvent` and the workflow carries the retry counters it returns, so a renamed field or a
 * mis-wired transition either fails every deployment or loops it until the workflow times out.
 */

import { Match, Template }                       from 'aws-cdk-lib/assertions';
import { CfnResource, Duration, Stack }          from 'aws-cdk-lib';

import {
  TEST_ACCOUNT,
  TEST_REGION,
  newDeployerTestStack,
  newWorkerStandIn,
  stateMachineDefinition,
  stateMachineLogicalId,
} from '../../../__tests__/deployer-infra-helpers';
import { renderWithTokens, statementsForAction } from '../../../cdk-test-support';
import { PollingCfnDeployerWorkflow }            from '../polling-cfn-deployer-workflow';
import type { PollingCfnDeployerWorkflowProps }  from '../polling-cfn-deployer-workflow';

interface SynthesizedWorkflow {
  readonly stack: Stack;
  readonly workflow: PollingCfnDeployerWorkflow;
  readonly template: Template;
}

function synthWorkflow(props: Partial<PollingCfnDeployerWorkflowProps> = {}): SynthesizedWorkflow {
  const { stack } = newDeployerTestStack();
  const workflow  = new PollingCfnDeployerWorkflow(stack, 'workflow', {
    handler: newWorkerStandIn(stack, 'worker'),
    stateMachineName: 'test-deployer-machine',
    ...props,
  });
  return { stack, workflow, template: Template.fromStack(stack) };
}

function synthWorkflowWithGrantee(): SynthesizedWorkflow {
  const { stack } = newDeployerTestStack();
  const grantee   = newWorkerStandIn(stack, 'grantee');
  const workflow  = new PollingCfnDeployerWorkflow(stack, 'workflow', {
    handler: newWorkerStandIn(stack, 'worker'),
    stateMachineName: 'test-deployer-machine',
  });
  workflow.grantStartAndDescribeExecutions(grantee);
  return { stack, workflow, template: Template.fromStack(stack) };
}

describe('PollingCfnDeployerWorkflow', () => {
  describe('state machine', () => {
    it('is named by the given name', () => {
      const { template } = synthWorkflow();

      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        StateMachineName: 'test-deployer-machine',
      });
    });

    it('times out after 90 minutes by default', () => {
      const { template } = synthWorkflow();

      expect(stateMachineDefinition(template).TimeoutSeconds).toBe(5400);
    });

    it('honors a custom timeout', () => {
      const { template } = synthWorkflow({ timeout: Duration.minutes(5) });

      expect(stateMachineDefinition(template).TimeoutSeconds).toBe(300);
    });

    it('waits 20 seconds between checks by default', () => {
      const { template } = synthWorkflow();

      expect(stateMachineDefinition(template).States.WaitBeforeCheck.Seconds).toBe(20);
    });

    it('honors a custom check interval', () => {
      const { template } = synthWorkflow({ checkInterval: Duration.seconds(7) });

      expect(stateMachineDefinition(template).States.WaitBeforeCheck.Seconds).toBe(7);
    });
  });

  describe('definition', () => {
    it('starts by seeding the attempt and retry counters beside the forwarded request', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      expect(definition.StartAt).toBe('Init');
      expect(definition.States.Init.Parameters).toEqual({
        'cfn.$': '$.cfn',
        'op.$': '$.op',
        attempt: 0,
        deleteRetryCount: 0,
        createRetryCount: 0,
      });
    });

    it('starts the operation with the request and the attempt only', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      const start = definition.States.StartStackOperation;
      expect(start.ResultPath).toBe('$.start');
      expect(start.Parameters).toEqual({
        mode: 'start',
        'cfn.$': '$.cfn',
        'op.$': '$.op',
        'attempt.$': '$.attempt',
      });
    });

    it('checks the operation with the request, the attempt and both retry counters', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      const check = definition.States.CheckStackOperation;
      expect(check.ResultPath).toBe('$.check');
      expect(check.Parameters).toEqual({
        mode: 'check',
        'cfn.$': '$.cfn',
        'op.$': '$.op',
        'attempt.$': '$.attempt',
        'deleteRetryCount.$': '$.deleteRetryCount',
        'createRetryCount.$': '$.createRetryCount',
      });
    });

    it('carries the retry counters the check returned into the next iteration and counts the attempt', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      expect(definition.States.IncrementAttempt.Parameters).toEqual({
        'cfn.$': '$.cfn',
        'op.$': '$.op',
        'start.$': '$.start',
        'check.$': '$.check',
        'attempt.$': 'States.MathAdd($.attempt, 1)',
        'deleteRetryCount.$': '$.check.deleteRetryCount',
        'createRetryCount.$': '$.check.createRetryCount',
      });
    });

    it('ends when the start already finished the operation and otherwise waits before the first check', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      expect(definition.States.StartStackOperation.Next).toBe('StartedOk?');
      expect(definition.States['StartedOk?'].Choices).toEqual([
        { Variable: '$.start.done', BooleanEquals: true, Next: 'Done' },
      ]);
      expect(definition.States['StartedOk?'].Default).toBe('WaitBeforeCheck');
    });

    it('reads the retry counters only after IsDone? found the check still polling, because a done result may carry none', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      expect(definition.States.WaitBeforeCheck.Next).toBe('CheckStackOperation');
      expect(definition.States.CheckStackOperation.Next).toBe('IsDone?');
      expect(definition.States['IsDone?'].Choices).toEqual([
        { Variable: '$.check.done', BooleanEquals: true, Next: 'Done' },
      ]);
      expect(definition.States['IsDone?'].Default).toBe('IncrementAttempt');
      expect(definition.States.IncrementAttempt.Next).toBe('WaitBeforeCheck');
      expect(definition.States.Done.Type).toBe('Succeed');
    });
  });

  describe('grantStartAndDescribeExecutions', () => {
    it('lets the grantee start the state machine itself', () => {
      const { stack, workflow, template } = synthWorkflowWithGrantee();

      const statements = statementsForAction(template, 'states:StartExecution');
      expect(statements).toHaveLength(1);
      expect(statements[0].Resource).toEqual(stack.resolve(workflow.stateMachineArn));
    });

    it('lets the grantee describe the executions of the named state machine, in the colon ARN form', () => {
      const { template } = synthWorkflowWithGrantee();

      const statements = statementsForAction(template, 'states:DescribeExecution');
      expect(statements).toHaveLength(1);
      expect(renderWithTokens(statements[0].Resource)).toBe(
        `arn:<token>:states:${TEST_REGION}:${TEST_ACCOUNT}:execution:test-deployer-machine:*`,
      );
    });
  });

  it('exposes the state machine as the dependable a dependent resource waits for', () => {
    const { stack } = newDeployerTestStack();
    const workflow  = new PollingCfnDeployerWorkflow(stack, 'workflow', {
      handler: newWorkerStandIn(stack, 'worker'),
      stateMachineName: 'test-deployer-machine',
    });
    new CfnResource(stack, 'dependent', { type: 'Custom::Dependent' }).node.addDependency(workflow.stateMachineDependable);

    const template = Template.fromStack(stack);
    template.hasResource('Custom::Dependent', {
      DependsOn: Match.arrayWith([stateMachineLogicalId(template)]),
    });
  });
});
