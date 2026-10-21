/// <reference types="jest" />

/**
 * Pins what the starter Lambda is given: the state machine it starts, named in its environment, and the
 * permission to start and follow that state machine's executions. Without either, a deployer's custom
 * resource cannot start its workflow and CloudFormation waits out the service timeout.
 */

import { Template }                               from 'aws-cdk-lib/assertions';

import { statementsForAction }                    from '../../../cdk-test-support';
import { newDeployerTestStack, newWorkerStandIn } from '../../../deployer-infra/__tests__/deployer-infra-helpers';
import { PollingCfnDeployerWorkflow }             from '../../workflows/polling-cfn-deployer-workflow';
import { DeployerStarterLambda }                  from '../deployer-starter-lambda';

const DEPLOYED_STACK_ARN = 'arn:aws:cloudformation:us-east-1:123456789012:stack/deployed-edge/*';

function synthStarter() {
  const { stack, artifactResolver } = newDeployerTestStack();
  const workflow                    = new PollingCfnDeployerWorkflow(stack, 'workflow', {
    handler: newWorkerStandIn(stack, 'worker'),
    stateMachineName: 'test-deployer-machine',
  });
  new DeployerStarterLambda(stack, 'starter', { artifactResolver, workflow, deployedStackName: 'edge', deployedStackArn: DEPLOYED_STACK_ARN });
  return { stack, workflow, template: Template.fromStack(stack) };
}

describe('DeployerStarterLambda', () => {
  it('runs the stack-deployer starter handler with the edge deployer service name', () => {
    const { template } = synthStarter();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.starterHandler',
      Timeout: 60,
      MemorySize: 256,
      Environment: { Variables: { SERVICE_NAME: 'stack-deployer-edge-starter' } },
    });
  });

  it("names the workflow's state machine in its environment", () => {
    const { stack, workflow, template } = synthStarter();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.starterHandler',
      Environment: {
        Variables: { MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN: stack.resolve(workflow.stateMachineArn) },
      },
    });
  });

  it('is allowed to start and describe the workflow executions', () => {
    const { template } = synthStarter();

    expect(statementsForAction(template, 'states:StartExecution')).toHaveLength(1);
    expect(statementsForAction(template, 'states:DescribeExecution')).toHaveLength(1);
  });

  it('is allowed to read the status of the stack it is deployed as and of the deployed stack, and of no other stack', () => {
    const { template } = synthStarter();

    const resources = statementsForAction(template, 'cloudformation:DescribeStacks').map((statement) => {
      expect(statement.Action).toBe('cloudformation:DescribeStacks');
      return statement.Resource;
    });
    expect(resources).toHaveLength(2);
    expect(resources).toEqual(expect.arrayContaining([{ Ref: 'AWS::StackId' }, DEPLOYED_STACK_ARN]));
  });
});
