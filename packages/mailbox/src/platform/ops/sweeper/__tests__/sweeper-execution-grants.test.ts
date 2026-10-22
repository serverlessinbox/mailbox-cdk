/// <reference types="jest" />

/**
 * SweeperExecutionGrants: what the state machine's execution role may do. Each grant names one ARN
 * and nothing wider, because this role invokes the worker and deletes only the sweeper's own
 * resources; a wildcard here would let a compromised execution delete other stacks' roles or functions.
 */

import { SweeperExecutionGrants }          from '../sweeper-execution-grants';

import { newTestStack, resolveStatements } from './sweeper-helpers';

describe('SweeperExecutionGrants', () => {
  const grants = new SweeperExecutionGrants({
    workerFunctionArn: 'arn:aws:lambda:us-west-2:123456789012:function:worker',
    workerRoleArn:     'arn:aws:iam::123456789012:role/worker-role',
    stateMachineArn:   'arn:aws:states:us-west-2:123456789012:stateMachine:sweeper',
    executionRoleArn:  'arn:aws:iam::123456789012:role/execution-role',
  });

  it('grants invoking and deleting the worker, deleting the worker role, the state machine and its own role policy, and describing its own stack', () => {
    const stack = newTestStack('ExecutionGrantsStack');

    expect(resolveStatements(stack, grants.statements())).toEqual([
      { Action: 'lambda:InvokeFunction', Effect: 'Allow', Resource: 'arn:aws:lambda:us-west-2:123456789012:function:worker' },
      { Action: 'lambda:DeleteFunction', Effect: 'Allow', Resource: 'arn:aws:lambda:us-west-2:123456789012:function:worker' },
      { Action: ['iam:DeleteRolePolicy', 'iam:DeleteRole'], Effect: 'Allow', Resource: 'arn:aws:iam::123456789012:role/worker-role' },
      { Action: 'states:DeleteStateMachine', Effect: 'Allow', Resource: 'arn:aws:states:us-west-2:123456789012:stateMachine:sweeper' },
      { Action: 'iam:DeleteRolePolicy', Effect: 'Allow', Resource: 'arn:aws:iam::123456789012:role/execution-role' },
      { Action: 'cloudformation:DescribeStackResource', Effect: 'Allow', Resource: { Ref: 'AWS::StackId' } },
    ]);
  });

  it('builds a new list of new statements on every call, so each policy document owns its own', () => {
    const [first]  = grants.statements();
    const [second] = grants.statements();

    expect(first).not.toBe(second);
  });
});
