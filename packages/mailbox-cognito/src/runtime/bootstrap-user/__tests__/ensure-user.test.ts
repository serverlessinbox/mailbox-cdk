/// <reference types="jest" />

/**
 * Pins what the bootstrap user Lambda asks Cognito for: a user is created with a suppressed invitation and the
 * password it was given, an existing user is left alone, a group that cannot be joined is reported while the
 * others are still joined, and the call fails only when none of the user's groups can be joined. Creating over an
 * existing user must not be a failure, or every repeated deployment would fail.
 */

import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  NotAuthorizedException,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { LoggerBuffer }                          from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                            from 'aws-sdk-client-mock';

import { toGroupName, toUserPoolId, toUsername } from '../../shared/cognito-identifiers';
import { UserEnsurer, type BootstrapUser }       from '../ensure-user';

function bootstrapUser(overrides: Partial<BootstrapUser> = {}): BootstrapUser {
  return {
    userPoolId:        toUserPoolId('us-east-1_12345678'),
    username:          toUsername('admin'),
    groups:            [],
    temporaryPassword: 'Temp1Password',
    ...overrides,
  };
}

describe('UserEnsurer', () => {
  const cognitoMock = mockClient(CognitoIdentityProviderClient);
  let userEnsurer: UserEnsurer;
  let logger: LoggerBuffer;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    cognitoMock.reset();
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    logger      = new LoggerBuffer('test-service', 'error');
    errorLog    = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    userEnsurer = new UserEnsurer(new CognitoIdentityProviderClient({}), logger);
  });

  it('creates the user with a suppressed invitation and the given password, and reports it as created', async () => {
    const ensured = await userEnsurer.ensure(bootstrapUser());

    expect(ensured.created).toBe(true);
    expect(cognitoMock.commandCalls(AdminCreateUserCommand)[0].args[0].input).toEqual({
      UserPoolId:        'us-east-1_12345678',
      Username:          'admin',
      MessageAction:     'SUPPRESS',
      TemporaryPassword: 'Temp1Password',
    });
  });

  it('reports a user that already exists as not created and still adds it to its groups', async () => {
    cognitoMock.on(AdminCreateUserCommand).rejects(new UsernameExistsException({ message: 'exists', $metadata: {} }));

    const ensured = await userEnsurer.ensure(bootstrapUser({ groups: [toGroupName('admin')] }));

    expect(ensured.created).toBe(false);
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)[0].args[0].input).toEqual({
      UserPoolId: 'us-east-1_12345678',
      Username:   'admin',
      GroupName:  'admin',
    });
  });

  it('throws a creation failure that is not an existing user, and adds no group', async () => {
    const denied = new NotAuthorizedException({ message: 'denied', $metadata: {} });
    cognitoMock.on(AdminCreateUserCommand).rejects(denied);

    await expect(userEnsurer.ensure(bootstrapUser({ groups: [toGroupName('admin')] }))).rejects.toBe(denied);
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0);
  });

  it('reports no failed group when every group is joined', async () => {
    const ensured = await userEnsurer.ensure(bootstrapUser({ groups: [toGroupName('admin'), toGroupName('user')] }));

    expect(ensured.failedGroups).toEqual([]);
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand).map((call) => call.args[0].input.GroupName)).toEqual(['admin', 'user']);
  });

  it('adds the user to every group, continuing past a group that cannot be joined, and lists that group as failed', async () => {
    cognitoMock.on(AdminAddUserToGroupCommand, { GroupName: 'missing' }).rejects(new Error('no such group'));

    const ensured = await userEnsurer.ensure(bootstrapUser({ groups: [toGroupName('missing'), toGroupName('user')] }));

    expect(ensured).toEqual({ created: true, failedGroups: ['missing'] });
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand).map((call) => call.args[0].input.GroupName)).toEqual(['missing', 'user']);
  });

  it('throws when no group of the user can be joined, naming every group with its error', async () => {
    cognitoMock.on(AdminAddUserToGroupCommand, { GroupName: 'missing' }).rejects(new Error('no such group'));
    cognitoMock.on(AdminAddUserToGroupCommand, { GroupName: 'other' }).rejects(new Error('access denied'));

    await expect(userEnsurer.ensure(bootstrapUser({ groups: [toGroupName('missing'), toGroupName('other')] })))
      .rejects.toThrow('No group of the bootstrap user could be joined: missing: no such group; other: access denied');
  });

  it('succeeds with no failed group when the user has no groups', async () => {
    const ensured = await userEnsurer.ensure(bootstrapUser({ groups: [] }));

    expect(ensured).toEqual({ created: true, failedGroups: [] });
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0);
  });

  it('logs a failed group join at error level, with the group name and the error, and still succeeds', async () => {
    cognitoMock.on(AdminAddUserToGroupCommand, { GroupName: 'missing' }).rejects(new Error('no such group'));

    await expect(userEnsurer.ensure(bootstrapUser({ groups: [toGroupName('missing'), toGroupName('user')] }))).resolves.toMatchObject({ created: true });

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith('bootstrap_user_group_join_failed', { groupName: 'missing', error: 'no such group' });
  });
});
