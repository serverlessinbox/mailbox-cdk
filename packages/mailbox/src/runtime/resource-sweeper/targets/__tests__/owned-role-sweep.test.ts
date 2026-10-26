/**
 * Coverage for `OwnedRoleSweep`, the role step the detector and the sweeper's worker role share. A role is deleted only
 * when the root stack owns it, its one named inline policy is deleted before the role, and a role that still has
 * attached policies is retried. A role another stack owns is never deleted, and that mismatch is final.
 */

import { DeleteRoleCommand, DeleteRolePolicyCommand, IAMClient, ListRoleTagsCommand }   from '@aws-sdk/client-iam';
import { LoggerBuffer }                                                                 from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                                                   from 'aws-sdk-client-mock';

import type { TargetResult }                                                            from '../../removal';
import { RootStackMembership }                                                          from '../../root-stack-membership';
import { TargetResults }                                                                from '../../target-results';
import { OwnedRoleSweep }                                                               from '../owned-role-sweep';

const iamMock = mockClient(IAMClient);

const ROOT_STACK_NAME = 'test-stack';
const ROOT_STACK_TAG  = 'serverless-inbox:root-stack';
const ROOT            = { rootStackName: ROOT_STACK_NAME, rootStackId: 'guid-1' };
const ROLE_ARN        = 'arn:aws:iam::123456789012:role/mailbox-sweeper-worker-aaaa1111-bbbb2222';
const ROLE_NAME       = 'mailbox-sweeper-worker-aaaa1111-bbbb2222';
const POLICY_NAME     = 'worker-policy';
const LABEL           = 'Sweeper worker IAM role';

function notFound(name: string): Error {
  return Object.assign(new Error(name), { name });
}

function sweep(): Promise<TargetResult> {
  const logger = new LoggerBuffer();
  const owned  = new OwnedRoleSweep(new IAMClient({ region: 'us-west-2' }), new RootStackMembership(logger), new TargetResults('sweeper-role'), logger);
  return owned.sweep(ROOT, ROLE_ARN, POLICY_NAME, LABEL);
}

function givenOwnedByRootStack(): void {
  iamMock.on(ListRoleTagsCommand).resolves({ Tags: [{ Key: ROOT_STACK_TAG, Value: ROOT_STACK_NAME }] });
  iamMock.on(DeleteRolePolicyCommand).resolves({});
  iamMock.on(DeleteRoleCommand).resolves({});
}

describe('OwnedRoleSweep', () => {
  beforeEach(() => {
    iamMock.reset();
  });

  it('deletes the named inline policy, then the role, once the root stack owns it', async () => {
    givenOwnedByRootStack();

    await expect(sweep()).resolves.toEqual({ target: 'sweeper-role', status: 'SUCCESS' });

    expect(iamMock.commandCalls(DeleteRolePolicyCommand)[0].args[0].input).toEqual({ RoleName: ROLE_NAME, PolicyName: POLICY_NAME });
    const deletionOrder = iamMock.calls().flatMap((call) => {
      if (call.args[0] instanceof DeleteRolePolicyCommand) {
        return ['policy'];
      }
      if (call.args[0] instanceof DeleteRoleCommand) {
        return ['role'];
      }
      return [];
    });
    expect(deletionOrder).toEqual(['policy', 'role']);
  });

  it('addresses IAM by the bare role name when the role ARN carries a path', async () => {
    givenOwnedByRootStack();
    const logger = new LoggerBuffer();
    const owned  = new OwnedRoleSweep(new IAMClient({ region: 'us-west-2' }), new RootStackMembership(logger), new TargetResults('sweeper-role'), logger);

    await owned.sweep(ROOT, `arn:aws:iam::123456789012:role/team/diag/${ROLE_NAME}`, POLICY_NAME, LABEL);

    expect(iamMock.commandCalls(ListRoleTagsCommand)[0].args[0].input).toEqual({ RoleName: ROLE_NAME });
    expect(iamMock.commandCalls(DeleteRoleCommand)[0].args[0].input).toEqual({ RoleName: ROLE_NAME });
  });

  it('deletes nothing when another stack owns the role, and that mismatch is final', async () => {
    iamMock.on(ListRoleTagsCommand).resolves({ Tags: [{ Key: ROOT_STACK_TAG, Value: 'other-stack' }] });

    await expect(sweep()).resolves.toMatchObject({ target: 'sweeper-role', status: 'FAILED' });

    expect(iamMock.commandCalls(DeleteRolePolicyCommand)).toHaveLength(0);
    expect(iamMock.commandCalls(DeleteRoleCommand)).toHaveLength(0);
  });

  it('treats a role that is already gone as swept', async () => {
    iamMock.on(ListRoleTagsCommand).rejects(notFound('NoSuchEntityException'));

    await expect(sweep()).resolves.toEqual({ target: 'sweeper-role', status: 'SUCCESS' });

    expect(iamMock.commandCalls(DeleteRoleCommand)).toHaveLength(0);
  });

  it('retries while the role still has attached policies', async () => {
    givenOwnedByRootStack();
    iamMock.on(DeleteRoleCommand).rejects(notFound('DeleteConflictException'));

    await expect(sweep()).resolves.toEqual({ target: 'sweeper-role', status: 'RETRY', reason: 'DeleteConflictException' });
  });

  it('still deletes the role when its inline policy is already gone', async () => {
    givenOwnedByRootStack();
    iamMock.on(DeleteRolePolicyCommand).rejects(notFound('NoSuchEntityException'));

    await expect(sweep()).resolves.toEqual({ target: 'sweeper-role', status: 'SUCCESS' });

    expect(iamMock.commandCalls(DeleteRoleCommand)).toHaveLength(1);
  });
});
