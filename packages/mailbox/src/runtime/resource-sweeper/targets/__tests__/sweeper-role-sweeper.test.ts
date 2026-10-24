/**
 * Coverage for `SweeperRoleSweeper`: the worker role the input names is swept under the sweeper's own target id, and a
 * role another stack owns is refused. The IAM client is faked at the AWS boundary.
 */

import { DeleteRoleCommand, DeleteRolePolicyCommand, IAMClient, ListRoleTagsCommand }   from '@aws-sdk/client-iam';
import { LoggerBuffer }                                                                 from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                                                   from 'aws-sdk-client-mock';

import type { SweeperRoleRemovalInput }                                                 from '../../removal';
import { RootStackMembership }                                                          from '../../root-stack-membership';
import { SweeperRoleSweeper }                                                           from '../sweeper-role-sweeper';

const iamMock = mockClient(IAMClient);

const ROOT_STACK_NAME = 'test-stack';
const ROOT_STACK_TAG  = 'serverless-inbox:root-stack';

const INPUT: SweeperRoleRemovalInput = {
  workerRoleArn:        'arn:aws:iam::123456789012:role/mailbox-sweeper-worker-aaaa1111-bbbb2222',
  workerRolePolicyName: 'worker-policy',
  rootStackName:        ROOT_STACK_NAME,
  rootStackId:          'guid-1',
};

function sweep(input: SweeperRoleRemovalInput = INPUT) {
  const logger  = new LoggerBuffer();
  const sweeper = new SweeperRoleSweeper(new IAMClient({ region: 'us-west-2' }), new RootStackMembership(logger), logger);
  return sweeper.sweep(input);
}

describe('SweeperRoleSweeper', () => {
  beforeEach(() => {
    iamMock.reset();
  });

  it('deletes the worker role the input names, and its named policy, under the sweeper-role target', async () => {
    iamMock.on(ListRoleTagsCommand).resolves({ Tags: [{ Key: ROOT_STACK_TAG, Value: ROOT_STACK_NAME }] });
    iamMock.on(DeleteRolePolicyCommand).resolves({});
    iamMock.on(DeleteRoleCommand).resolves({});

    await expect(sweep()).resolves.toEqual({ target: 'sweeper-role', status: 'SUCCESS' });

    expect(iamMock.commandCalls(DeleteRolePolicyCommand)[0].args[0].input).toEqual({
      RoleName:   'mailbox-sweeper-worker-aaaa1111-bbbb2222',
      PolicyName: 'worker-policy',
    });
    expect(iamMock.commandCalls(DeleteRoleCommand)[0].args[0].input).toEqual({ RoleName: 'mailbox-sweeper-worker-aaaa1111-bbbb2222' });
  });

  it('refuses a worker role another stack owns, and deletes nothing', async () => {
    iamMock.on(ListRoleTagsCommand).resolves({ Tags: [{ Key: ROOT_STACK_TAG, Value: 'other-stack' }] });

    await expect(sweep()).resolves.toMatchObject({ target: 'sweeper-role', status: 'FAILED' });

    expect(iamMock.commandCalls(DeleteRoleCommand)).toHaveLength(0);
  });
});
