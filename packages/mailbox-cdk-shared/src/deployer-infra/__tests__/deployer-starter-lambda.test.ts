/// <reference types="jest" />

/**
 * Pins what the starter Lambda is given: the state machine it starts, named in its environment, and the
 * permission to start and follow that state machine's executions. Without either, a deployer's custom
 * resource cannot start its workflow and CloudFormation waits out the service timeout.
 */

import { Template } from 'aws-cdk-lib/assertions';
import { DeployerStarterLambda } from '../deployer-starter-lambda';
import { PollingCfnDeployerWorkflow } from '../polling-cfn-deployer-workflow';
import { newDeployerTestStack, newWorkerStandIn, statementsForAction } from './deployer-infra-helpers';

function synthStarter() {
  const { stack, artifactResolver } = newDeployerTestStack();
  const workflow = new PollingCfnDeployerWorkflow(stack, 'workflow', {
    handler: newWorkerStandIn(stack, 'worker'),
    stateMachineName: 'test-deployer-machine',
  });
  new DeployerStarterLambda(stack, 'starter', { artifactResolver, workflow, deployedStackName: 'edge' });
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
});
