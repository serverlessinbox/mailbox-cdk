/// <reference types="jest" />

/**
 * Pins what a deployer's Lambdas hold on the stack the deployer deploys. The stack is created by a custom
 * resource, so the grants name it by ARN pattern: a grant that names another resource, or more actions than
 * the Lambda calls, lets a deployer reach stacks it does not own.
 */

import { Template }                               from 'aws-cdk-lib/assertions';

import { newDeployerTestStack, newWorkerStandIn } from '../../../__tests__/deployer-infra-helpers';
import { statementsForAction }                    from '../../../cdk-test-support';
import { DeployedStack }                          from '../deployed-stack';

const STACK_ARN = 'arn:aws:cloudformation:us-west-2:123456789012:stack/probe/*';

function synthGrant(grant: (deployedStack: DeployedStack, grantee: ReturnType<typeof newWorkerStandIn>) => void): Template {
  const { stack } = newDeployerTestStack();
  grant(new DeployedStack(STACK_ARN), newWorkerStandIn(stack, 'grantee'));
  return Template.fromStack(stack);
}

describe('DeployedStack', () => {
  it('lets the grantee manage the stack, without reading its template', () => {
    const template = synthGrant((deployedStack, grantee) => deployedStack.grantLifecycle(grantee));

    const statements = statementsForAction(template, 'cloudformation:CreateStack');
    expect(statements).toHaveLength(1);
    expect(statements[0].Resource).toEqual(STACK_ARN);
    expect(statements[0].Action).toEqual([
      'cloudformation:CreateStack',
      'cloudformation:UpdateStack',
      'cloudformation:DeleteStack',
      'cloudformation:DescribeStacks',
      'cloudformation:DescribeStackEvents',
      'cloudformation:GetTemplateSummary',
      'cloudformation:GetStackPolicy',
      'cloudformation:SetStackPolicy',
    ]);
  });

  it('lets the grantee read the template of the stack and nothing else', () => {
    const template = synthGrant((deployedStack, grantee) => deployedStack.grantTemplateRead(grantee));

    const statements = statementsForAction(template, 'cloudformation:GetTemplate');
    expect(statements).toHaveLength(1);
    expect(statements[0].Action).toBe('cloudformation:GetTemplate');
    expect(statements[0].Resource).toEqual(STACK_ARN);
  });

  it('lets the grantee describe the stack and nothing else', () => {
    const template = synthGrant((deployedStack, grantee) => deployedStack.grantDescribe(grantee));

    const statements = statementsForAction(template, 'cloudformation:DescribeStacks');
    expect(statements).toHaveLength(1);
    expect(statements[0].Action).toBe('cloudformation:DescribeStacks');
    expect(statements[0].Resource).toEqual(STACK_ARN);
  });

  it('names every ARN pattern it is given in each grant', () => {
    const otherArn  = 'arn:aws:cloudformation:us-west-2:123456789012:stack/other-*/*';
    const { stack } = newDeployerTestStack();
    const grantee   = newWorkerStandIn(stack, 'grantee');

    new DeployedStack(STACK_ARN, otherArn).grantLifecycle(grantee);

    const statements = statementsForAction(Template.fromStack(stack), 'cloudformation:CreateStack');
    expect(statements).toHaveLength(1);
    expect(statements[0].Resource).toEqual([STACK_ARN, otherArn]);
  });
});
