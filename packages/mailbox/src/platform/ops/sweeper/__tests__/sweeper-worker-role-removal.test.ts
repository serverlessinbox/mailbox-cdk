/// <reference types="jest" />

/**
 * SweeperWorkerRoleRemoval: the grants, `ResourceProperties` entry and state-machine step for sweeping the sweeper's own
 * worker role after a move. The grants are scoped by name pattern to the worker roles of this install, and the step
 * is skipped on a request whose execution input carries no worker role.
 */

import type { Construct }                                     from 'constructs';

import { newTestStack }                                       from '../../../__tests__/platform-helpers';
import { SweeperWorkerRoleRemoval }                           from '../sweeper-worker-role-removal';

import {
  renderRemovalChain,
  renderRemovalChainWithRefs,
  resolveStatements,
  startStateOf,
  stateOf,
} from './sweeper-helpers';

const WORKER_ROLE_ARN = 'arn:aws:iam::123456789012:role/mailbox-sweeper-worker-aaaa1111-bbbb2222';
const POLICY_NAME     = 'worker-policy';

function newRemoval(scope: Construct): SweeperWorkerRoleRemoval {
  return new SweeperWorkerRoleRemoval(scope, 'worker-role-removal', {
    workerRoleArn:        WORKER_ROLE_ARN,
    workerRolePolicyName: POLICY_NAME,
  });
}

describe('SweeperWorkerRoleRemoval', () => {
  it('lists the role tags, then deletes the policy and the role, every grant scoped to the worker roles of this install', () => {
    const stack      = newTestStack('WorkerRoleGrantsStack');
    const statements = resolveStatements(stack, newRemoval(stack).grantStatements());

    expect(statements).toEqual([
      expect.objectContaining({ Action: 'iam:ListRoleTags', Effect: 'Allow' }),
      expect.objectContaining({ Action: ['iam:DeleteRolePolicy', 'iam:DeleteRole'], Effect: 'Allow' }),
    ]);
    expect(JSON.stringify(statements)).toContain('role/mailbox-sweeper-worker-*-');
  });

  it('puts the worker role ARN and its policy name in its ResourceProperties entry', () => {
    expect(newRemoval(newTestStack('WorkerRoleEntryStack')).crProperties()).toEqual({
      workerRoleArn:        WORKER_ROLE_ARN,
      workerRolePolicyName: POLICY_NAME,
    });
  });

  it('skips to the next state when no sweeper-role target is in the execution input', () => {
    const stack      = newTestStack('WorkerRoleChainStack');
    const definition = renderRemovalChain(stack, newRemoval(stack));

    expect(stateOf(definition, startStateOf(definition)).Default).toBe('Done');
  });

  it('sends the root stack name as a reference to the stack, not a literal', () => {
    const stack      = newTestStack('WorkerRoleRefStack');
    const definition = renderRemovalChainWithRefs(stack, newRemoval(stack));

    expect(definition).toContain('{"Ref":"AWS::StackName"}');
  });
});
