/// <reference types="jest" />

/**
 * Pins the state machine that polls a sub-stack deployment. The worker Lambda reads each invocation as
 * an `SfnInvokeEvent` and the workflow carries the retry counters it returns, so a renamed field or a
 * mis-wired transition either fails every deployment or loops it until the workflow times out.
 */

import { Template }                              from 'aws-cdk-lib/assertions';
import { Duration, Stack }                       from 'aws-cdk-lib';

import {
  TEST_ACCOUNT,
  TEST_REGION,
  newDeployerTestStack,
  newWorkerStandIn,
  stateMachineDefinition,
} from '../../../__tests__/deployer-infra-helpers';
import { statementsForAction }                   from '../../../cdk-test-support';
import { PollingCfnDeployerWorkflow }            from '../polling-cfn-deployer-workflow';
import type { PollingCfnDeployerWorkflowProps }  from '../polling-cfn-deployer-workflow';

interface SynthesizedWorkflow {
  readonly stack:    Stack;
  readonly workflow: PollingCfnDeployerWorkflow;
  readonly template: Template;
}

function synthWorkflow(props: Partial<PollingCfnDeployerWorkflowProps> = {}): SynthesizedWorkflow {
  const { stack } = newDeployerTestStack();
  const workflow  = new PollingCfnDeployerWorkflow(stack, 'workflow', {
    handler:          newWorkerStandIn(stack, 'worker'),
    stateMachineName: 'test-deployer-machine',
    ...props,
  });
  return { stack, workflow, template: Template.fromStack(stack) };
}

function synthWorkflowWithGrantee(): SynthesizedWorkflow {
  const { stack } = newDeployerTestStack();
  const grantee   = newWorkerStandIn(stack, 'grantee');
  const workflow  = new PollingCfnDeployerWorkflow(stack, 'workflow', {
    handler:          newWorkerStandIn(stack, 'worker'),
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

      expect(stateMachineDefinition(template).States['wait-before-check'].Seconds).toBe(20);
    });

    it('honors a custom check interval', () => {
      const { template } = synthWorkflow({ checkInterval: Duration.seconds(7) });

      expect(stateMachineDefinition(template).States['wait-before-check'].Seconds).toBe(7);
    });
  });

  describe('definition', () => {
    it('starts by seeding the attempt and retry counters beside the forwarded request', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      expect(definition.StartAt).toBe('init');
      expect(definition.States.init.Parameters).toEqual({
        'cfn.$':          '$.cfn',
        'op.$':           '$.op',
        attempt:          0,
        deleteRetryCount: 0,
        createRetryCount: 0,
      });
    });

    it('starts the operation with the request and the attempt only', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      const start = definition.States['start-stack-operation'];
      expect(start.ResultPath).toBe('$.start');
      expect(start.Parameters).toEqual({
        mode:        'start',
        'cfn.$':     '$.cfn',
        'op.$':      '$.op',
        'attempt.$': '$.attempt',
      });
    });

    it('checks the operation with the request, the attempt and both retry counters', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      const check = definition.States['check-stack-operation'];
      expect(check.ResultPath).toBe('$.check');
      expect(check.Parameters).toEqual({
        mode:                 'check',
        'cfn.$':              '$.cfn',
        'op.$':               '$.op',
        'attempt.$':          '$.attempt',
        'deleteRetryCount.$': '$.deleteRetryCount',
        'createRetryCount.$': '$.createRetryCount',
      });
    });

    it('carries the retry counters the check returned into the next iteration and counts the attempt', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      expect(definition.States['increment-attempt'].Parameters).toEqual({
        'cfn.$':              '$.cfn',
        'op.$':               '$.op',
        'start.$':            '$.start',
        'check.$':            '$.check',
        'attempt.$':          'States.MathAdd($.attempt, 1)',
        'deleteRetryCount.$': '$.check.deleteRetryCount',
        'createRetryCount.$': '$.check.createRetryCount',
      });
    });

    it('ends when the start already finished the operation and otherwise waits before the first check', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      expect(definition.States['start-stack-operation'].Next).toBe('started-ok');
      expect(definition.States['started-ok'].Choices).toEqual([
        { Variable: '$.start.done', BooleanEquals: true, Next: 'done' },
      ]);
      expect(definition.States['started-ok'].Default).toBe('wait-before-check');
    });

    it('reads the retry counters only after is-done found the check still polling, because a done result may carry none', () => {
      const definition = stateMachineDefinition(synthWorkflow().template);

      expect(definition.States['wait-before-check'].Next).toBe('check-stack-operation');
      expect(definition.States['check-stack-operation'].Next).toBe('is-done');
      expect(definition.States['is-done'].Choices).toEqual([
        { Variable: '$.check.done', BooleanEquals: true, Next: 'done' },
      ]);
      expect(definition.States['is-done'].Default).toBe('increment-attempt');
      expect(definition.States['increment-attempt'].Next).toBe('wait-before-check');
      expect(definition.States.done.Type).toBe('Succeed');
    });
  });

  describe('grantStartAndDescribeExecutions', () => {
    it('lets the grantee start the state machine itself', () => {
      const { stack, workflow, template } = synthWorkflowWithGrantee();

      const statements = statementsForAction(template, 'states:StartExecution');
      expect(statements).toHaveLength(1);
      expect(statements[0].Resource).toEqual(stack.resolve(workflow.stateMachineArn));
    });

    it('lets the grantee describe every execution of the state machine, in the colon ARN form', () => {
      const { stack, workflow, template } = synthWorkflowWithGrantee();

      const statements = statementsForAction(template, 'states:DescribeExecution');
      expect(statements).toHaveLength(1);
      expect(statements[0].Resource).toEqual({
        'Fn::Join': [
          '',
          [
            'arn:',
            { Ref: 'AWS::Partition' },
            `:states:${TEST_REGION}:${TEST_ACCOUNT}:execution:`,
            { 'Fn::Select': [6, { 'Fn::Split': [':', stack.resolve(workflow.stateMachineArn)] }] },
            ':*',
          ],
        ],
      });
    });
  });
});
