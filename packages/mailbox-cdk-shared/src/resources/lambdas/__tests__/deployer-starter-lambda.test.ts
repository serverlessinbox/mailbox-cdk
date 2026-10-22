/// <reference types="jest" />

/**
 * Pins what the starter Lambda is given: the state machine it starts, named in its environment, and the
 * permission to start and follow that state machine's executions. Without either, a deployer's custom
 * resource cannot start its workflow and CloudFormation waits out the service timeout.
 */

import { Template }                               from 'aws-cdk-lib/assertions';

import { newDeployerTestStack, newWorkerStandIn } from '../../../__tests__/deployer-infra-helpers';
import { statementsForAction }                    from '../../../cdk-test-support';
import type { IDeployedStack }                    from '../../stacks/deployed-stack';
import { PollingCfnDeployerWorkflow }             from '../../workflows/polling-cfn-deployer-workflow';
import { DeployerStarterLambda }                  from '../deployer-starter-lambda';

const deployedStack: IDeployedStack = {
  grantLifecycle:    jest.fn(),
  grantTemplateRead: jest.fn(),
  grantDescribe:     jest.fn(),
};

function synthStarter() {
  const { stack, artifactResolver } = newDeployerTestStack();
  const workflow                    = new PollingCfnDeployerWorkflow(stack, 'workflow', {
    handler:          newWorkerStandIn(stack, 'worker'),
    stateMachineName: 'test-deployer-machine',
  });
  const starter                     = new DeployerStarterLambda(stack, 'starter', { artifactResolver, workflow, deployedStackName: 'edge', deployedStack });
  return { stack, workflow, starter, template: Template.fromStack(stack) };
}

describe('DeployerStarterLambda', () => {
  it('runs the stack-deployer starter handler with the edge deployer service name', () => {
    const { template } = synthStarter();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler:     'index.starterHandler',
      Timeout:     60,
      MemorySize:  256,
      Environment: { Variables: { SERVICE_NAME: 'stack-deployer-edge-starter' } },
    });
  });

  it("names the workflow's state machine in its environment", () => {
    const { stack, workflow, template } = synthStarter();

    const stateMachineArn: unknown = stack.resolve(workflow.stateMachineArn);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler:     'index.starterHandler',
      Environment: {
        Variables: { MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN: stateMachineArn },
      },
    });
  });

  it('is allowed to start and describe the workflow executions', () => {
    const { template } = synthStarter();

    expect(statementsForAction(template, 'states:StartExecution')).toHaveLength(1);
    expect(statementsForAction(template, 'states:DescribeExecution')).toHaveLength(1);
  });

  it('is allowed to read the status of the stack it is deployed as', () => {
    const { template } = synthStarter();

    const statements = statementsForAction(template, 'cloudformation:DescribeStacks');
    expect(statements.map((statement) => statement.Resource)).toEqual([{ Ref: 'AWS::StackId' }]);
  });

  it('grants itself the description of the deployed stack it is given', () => {
    const { starter } = synthStarter();

    expect(deployedStack.grantDescribe).toHaveBeenCalledWith(starter);
  });
});
