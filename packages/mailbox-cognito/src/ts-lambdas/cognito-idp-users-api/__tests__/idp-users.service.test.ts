/// <reference types="jest" />

/**
 * Pins what the user service asks of Cognito for each request, how it answers a Cognito failure, and what it
 * records in the audit. The service wrapper turns the error class the service throws into the HTTP status,
 * so a failure classified as the wrong class answers the caller with the wrong status; the audit entries are all
 * the audit trail knows of a request, so a password in one is a leak and a failure without one is a gap that
 * cannot be seen afterwards. Creating a user is all or nothing: a failure after Cognito created the user
 * must delete it again, or the caller sees a failed request while an orphan user, possibly without a mailbox
 * principal or a group, can sign in.
 */

import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { create }       from '@bufbuild/protobuf';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  toPrincipalId as toCallerPrincipalId,
  toTenantId as toCallerTenantId,
  type HandlerContext,
} from '@serverlessinbox/mailbox-addon-sdk';
import { LoggerBuffer, toAccountId, toFunctionName } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                from 'aws-sdk-client-mock';

import { toGroupName, toUserPoolId, type GroupName } from '../../../runtime/shared/cognito-identifiers';
import { toPrincipalId }                             from '../../../runtime/shared/identity-identifiers';
import { IdentityProvisionerClient }                 from '../../../runtime/shared/identity-provisioner-client';
import {
  CreateIdpUserRequestSchema,
  DeleteIdpUserRequestSchema,
  GetIdpUserRequestSchema,
  ListIdpUsersRequestSchema,
  SetIdpUserEnabledRequestSchema,
  SetIdpUserPasswordRequestSchema,
} from '../generated/idp_users_pb';
import { IdpUserMapper }            from '../idp-user-mapper';
import { CognitoIdpUsersService }   from '../idp-users.service';
import { IdpUsersRequestValidator } from '../idp-users.validation';

const USER_POOL_ID    = 'pool-1';
const TENANT_ID       = 'tenant-123';
const COGNITO_MESSAGE = 'Cognito said so';

/** The context of a request from a fixed admin caller, whose audit recording is a spy. */
function context(): jest.Mocked<HandlerContext> {
  return {
    caller:      {
      tenantId:      toCallerTenantId(TENANT_ID),
      principalId:   toCallerPrincipalId('caller-principal'),
      principalName: 'caller',
      displayName:   'Caller',
      groups:        ['admin'],
    },
    requestId:   'request-1',
    recordAudit: jest.fn<Promise<void>, Parameters<HandlerContext['recordAudit']>>().mockResolvedValue(undefined),
  };
}

function cognitoError(name: string, message: string = COGNITO_MESSAGE): Error {
  return Object.assign(new Error(message), { name });
}

describe('CognitoIdpUsersService', () => {
  const cognitoMock         = mockClient(CognitoIdentityProviderClient);
  const logger              = new LoggerBuffer(undefined, 'error');
  const identityProvisioner = new IdentityProvisionerClient(toFunctionName('identity-provisioner'), new LambdaClient({}));
  const provisionUser       = jest.spyOn(identityProvisioner, 'provisionUser');
  const logError            = jest.spyOn(logger, 'error');
  const logWarn             = jest.spyOn(logger, 'warn');
  const flushLogs           = jest.spyOn(logger, 'flush');

  function newService(adminGroups: GroupName[] = [toGroupName('admin')], userGroups: GroupName[] = [toGroupName('user')]): CognitoIdpUsersService {
    return new CognitoIdpUsersService(new CognitoIdentityProviderClient({}), toUserPoolId(USER_POOL_ID), {
      identityProvisioner,
      userMapper: new IdpUserMapper(),
      validator:  new IdpUsersRequestValidator(),
      adminGroups,
      userGroups,
      logger,
    });
  }

  beforeEach(() => {
    cognitoMock.reset();
    cognitoMock.onAnyCommand().resolves({});
    provisionUser.mockReset().mockResolvedValue({ principalId: toPrincipalId('p1'), primaryAccountId: toAccountId('a1'), isNewUser: true });
    logError.mockReset().mockImplementation(() => undefined);
    logWarn.mockReset().mockImplementation(() => undefined);
    flushLogs.mockClear();
  });

  describe('listIdpUsers', () => {
    it('lists the users of the pool page by page and returns the next page token', async () => {
      cognitoMock.on(ListUsersCommand).resolves({ Users: [{ Username: 'alice', Enabled: true }], PaginationToken: 'next-page' });
      const request = create(ListIdpUsersRequestSchema, { pageSize: 10, pageToken: 'this-page', filter: 'username ^= "al"' });

      const response = await newService().listIdpUsers(context(), request);

      expect(cognitoMock.commandCalls(ListUsersCommand)[0].args[0].input).toEqual({
        UserPoolId:      USER_POOL_ID,
        Limit:           10,
        PaginationToken: 'this-page',
        Filter:          'username ^= "al"',
      });
      expect(response.users.map((user) => user.username)).toEqual(['alice']);
      expect(response.nextPageToken).toBe('next-page');
    });

    it('returns an empty next page token on the last page', async () => {
      cognitoMock.on(ListUsersCommand).resolves({ Users: [] });

      const response = await newService().listIdpUsers(context(), create(ListIdpUsersRequestSchema, {}));

      expect(response.nextPageToken).toBe('');
    });
  });

  describe('getIdpUser', () => {
    it('returns the user and records nothing in the audit', async () => {
      cognitoMock.on(AdminGetUserCommand).resolves({ Username: 'alice', Enabled: true, UserAttributes: [{ Name: 'email', Value: 'alice@example.com' }] });
      const ctx = context();

      const response = await newService().getIdpUser(ctx, create(GetIdpUserRequestSchema, { username: 'alice' }));

      expect(cognitoMock.commandCalls(AdminGetUserCommand)[0].args[0].input).toEqual({ UserPoolId: USER_POOL_ID, Username: 'alice' });
      expect(response.user?.attributes).toEqual({ email: 'alice@example.com' });
      expect(ctx.recordAudit).not.toHaveBeenCalled();
    });
  });

  describe('createIdpUser', () => {
    const request = (overrides: { email?: string; enabled?: boolean; groups?: string[] } = {}) =>
      create(CreateIdpUserRequestSchema, { username: 'newuser', email: 'newuser@example.com', password: 'Passw0rd!', groups: ['user'], ...overrides });

    // The sub is deliberately unlike the username, so an assertion on the subject cannot pass if the username is used for it.
    function cognitoReturnsUser(user: { enabled?: boolean; sub?: string } = {}): void {
      cognitoMock.on(AdminGetUserCommand).resolves({
        Username:       'newuser',
        Enabled:        user.enabled,
        UserAttributes: user.sub ? [{ Name: 'sub', Value: user.sub }] : [],
      });
    }

    it('creates the user without sending a message, then makes its password permanent', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });

      await newService().createIdpUser(context(), request());

      expect(cognitoMock.commandCalls(AdminCreateUserCommand)[0].args[0].input).toEqual({
        UserPoolId:        USER_POOL_ID,
        Username:          'newuser',
        TemporaryPassword: 'Passw0rd!',
        MessageAction:     'SUPPRESS',
        UserAttributes:    [{ Name: 'email', Value: 'newuser@example.com' }],
      });
      expect(cognitoMock.commandCalls(AdminSetUserPasswordCommand)[0].args[0].input).toEqual({
        UserPoolId: USER_POOL_ID,
        Username:   'newuser',
        Password:   'Passw0rd!',
        Permanent:  true,
      });
    });

    it('creates a user without an email attribute when the request has no email', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });

      await newService().createIdpUser(context(), request({ email: '' }));

      expect(cognitoMock.commandCalls(AdminCreateUserCommand)[0].args[0].input.UserAttributes).toEqual([]);
    });

    it('disables the user only when the request asks for a disabled user', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });

      await newService().createIdpUser(context(), request());
      expect(cognitoMock.commandCalls(AdminDisableUserCommand)).toHaveLength(0);

      await newService().createIdpUser(context(), request({ enabled: false }));
      expect(cognitoMock.commandCalls(AdminDisableUserCommand)[0].args[0].input).toEqual({ UserPoolId: USER_POOL_ID, Username: 'newuser' });
    });

    it('adds the user to only the requested groups when the request names groups', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });
      const configured = [toGroupName('team'), toGroupName('viewer')];

      await newService(undefined, configured).createIdpUser(context(), request({ groups: ['staff', 'finance'] }));

      expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand).map((call) => call.args[0].input.GroupName)).toEqual(['staff', 'finance']);
    });

    it('adds the user to every configured user group when the request names none', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });
      const configured = [toGroupName('team'), toGroupName('viewer')];

      await newService(undefined, configured).createIdpUser(context(), request({ groups: [] }));

      expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand).map((call) => call.args[0].input.GroupName)).toEqual(['team', 'viewer']);
    });

    it('creates the user and warns about each group it could not join when it joined at least one group', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });
      cognitoMock.on(AdminAddUserToGroupCommand, { GroupName: 'staff' }).rejects(cognitoError('ResourceNotFoundException', 'Group not found'));

      const response = await newService().createIdpUser(context(), request({ groups: ['staff', 'finance'] }));

      expect(response.user?.username).toBe('newuser');
      expect(logWarn).toHaveBeenCalledTimes(1);
      expect(logWarn).toHaveBeenCalledWith('idp_user_group_join_failed', { username: 'newuser', group: 'staff', error: 'ResourceNotFoundException: Group not found' });
      expect(cognitoMock.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
    });

    it('fails with the first join failure, after warning about each group, when no group could be joined', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });
      const firstFailure = cognitoError('ResourceNotFoundException', 'Group staff not found');
      cognitoMock.on(AdminAddUserToGroupCommand, { GroupName: 'staff' }).rejects(firstFailure);
      cognitoMock.on(AdminAddUserToGroupCommand, { GroupName: 'finance' }).rejects(cognitoError('ResourceNotFoundException', 'Group finance not found'));

      const rejection = await newService().createIdpUser(context(), request({ groups: ['staff', 'finance'] })).catch((thrown: unknown) => thrown);

      expect(rejection).toBe(firstFailure);
      expect(logWarn.mock.calls.map((warnArguments) => warnArguments[1]?.group)).toEqual(['staff', 'finance']);
      expect(cognitoMock.commandCalls(AdminDeleteUserCommand)).toHaveLength(1);
    });

    describe('when a step after the creation of the user fails', () => {
      const serviceUnavailable = cognitoError('ServiceUnavailableException');

      async function rejectionOfCreate(overrides: { enabled?: boolean } = {}): Promise<unknown> {
        return newService().createIdpUser(context(), request(overrides)).then(
          () => { throw new Error('expected the creation to reject'); },
          (rejection: unknown) => rejection,
        );
      }

      function expectUserDeletedOnce(): void {
        const deletions = cognitoMock.commandCalls(AdminDeleteUserCommand);
        expect(deletions).toHaveLength(1);
        expect(deletions[0].args[0].input).toEqual({ UserPoolId: USER_POOL_ID, Username: 'newuser' });
      }

      it.each([
        { step: 'making the password permanent', enabled: true, failStep: () => cognitoMock.on(AdminSetUserPasswordCommand).rejects(serviceUnavailable) },
        { step: 'disabling the user', enabled: false, failStep: () => cognitoMock.on(AdminDisableUserCommand).rejects(serviceUnavailable) },
        { step: 'joining the groups', enabled: true, failStep: () => cognitoMock.on(AdminAddUserToGroupCommand).rejects(serviceUnavailable) },
        { step: 'fetching the user', enabled: true, failStep: () => cognitoMock.on(AdminGetUserCommand).rejects(serviceUnavailable) },
      ])('deletes the user and answers with the failure of $step', async ({ enabled, failStep }) => {
        failStep();

        expect(await rejectionOfCreate({ enabled })).toBe(serviceUnavailable);
        expectUserDeletedOnce();
      });

      it('deletes the user and answers with the provisioning failure, which it logs', async () => {
        cognitoReturnsUser({ sub: 'cognito-sub-abc' });
        const provisioningFailure = new Error('AccessDenied');
        provisionUser.mockRejectedValueOnce(provisioningFailure);

        expect(await rejectionOfCreate()).toBe(provisioningFailure);
        expect(logError).toHaveBeenCalledWith('idp_user_provision_invoke_failed', { username: 'newuser', error: 'Error: AccessDenied' });
        expect(flushLogs).not.toHaveBeenCalled();
        expectUserDeletedOnce();
      });

      it('deletes the user and fails, without provisioning, when Cognito reports no sub', async () => {
        cognitoReturnsUser({});

        expect(await rejectionOfCreate()).toEqual(new Error('Cognito reported no sub for the created user'));
        expect(provisionUser).not.toHaveBeenCalled();
        expect(logError).toHaveBeenCalledWith('idp_user_provision_missing_sub', { username: 'newuser' });
        expectUserDeletedOnce();
      });

      it('logs the failed deletion with the username and still answers with the original failure', async () => {
        cognitoMock.on(AdminSetUserPasswordCommand).rejects(serviceUnavailable);
        cognitoMock.on(AdminDeleteUserCommand).rejects(cognitoError('InternalErrorException', 'Delete refused'));

        expect(await rejectionOfCreate()).toBe(serviceUnavailable);
        expect(logError).toHaveBeenCalledWith('idp_user_rollback_delete_failed', { username: 'newuser', error: 'InternalErrorException: Delete refused' });
      });

      it('does not delete a user it did not create when the creation itself fails', async () => {
        cognitoMock.on(AdminCreateUserCommand).rejects(cognitoError('UsernameExistsException'));

        expect(await rejectionOfCreate()).toBeInstanceOf(ConflictError);
        expect(cognitoMock.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
      });
    });

    it('reports the requested enabled state when Cognito reports none for the created user', async () => {
      cognitoReturnsUser({ enabled: undefined, sub: 'cognito-sub-abc' });

      const response = await newService().createIdpUser(context(), request());

      expect(response.user?.enabled).toBe(true);
    });

    it('records the created user and what was requested as one successful audit entry', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });
      const ctx = context();

      await newService().createIdpUser(ctx, request({ enabled: false }));

      expect(ctx.recordAudit).toHaveBeenCalledTimes(1);
      expect(ctx.recordAudit).toHaveBeenCalledWith({
        status:     'success',
        entityId:   'newuser',
        entityName: 'newuser@example.com',
        changes:    [{ field: 'user', newValue: { username: 'newuser', email: 'newuser@example.com', enabled: false, groups: ['user'] } }],
      });
    });

    it('never records the password in the audit', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });
      const ctx = context();

      await newService().createIdpUser(ctx, request());

      expect(JSON.stringify(jest.mocked(ctx.recordAudit).mock.calls)).not.toContain('Passw0rd!');
    });

    it('records a failure, with the failure message, when the creation is rolled back', async () => {
      cognitoMock.on(AdminSetUserPasswordCommand).rejects(cognitoError('ServiceUnavailableException', 'Cognito is down'));
      const ctx = context();

      await newService().createIdpUser(ctx, request()).catch(() => undefined);

      expect(ctx.recordAudit).toHaveBeenCalledTimes(1);
      expect(ctx.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure', entityId: 'newuser', errorMsg: 'Cognito is down' }));
    });

    it('provisions the mailbox principal under the Cognito sub, never the username', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });

      await newService().createIdpUser(context(), request());

      expect(provisionUser).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        subject:  'cognito-sub-abc',
        username: 'newuser',
        email:    'newuser@example.com',
        groups:   ['user'],
        isAdmin:  false,
      });
    });

    it('provisions an admin when a group of the user is an admin group, whatever the case', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });

      await newService([toGroupName('admin')]).createIdpUser(context(), request({ groups: ['Admin'] }));

      expect(provisionUser).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }));
    });

  });

  describe('setIdpUserEnabled', () => {
    it.each([
      { enabled: true, called: AdminEnableUserCommand, notCalled: AdminDisableUserCommand },
      { enabled: false, called: AdminDisableUserCommand, notCalled: AdminEnableUserCommand },
    ])('sends the command that sets enabled=$enabled and records it in the audit', async ({ enabled, called, notCalled }) => {
      const ctx = context();

      await newService().setIdpUserEnabled(ctx, create(SetIdpUserEnabledRequestSchema, { username: 'alice', enabled }));

      expect(cognitoMock.commandCalls(called)[0].args[0].input).toEqual({ UserPoolId: USER_POOL_ID, Username: 'alice' });
      expect(cognitoMock.commandCalls(notCalled)).toHaveLength(0);
      expect(ctx.recordAudit).toHaveBeenCalledWith({ status: 'success', entityId: 'alice', entityName: 'alice', changes: [{ field: 'enabled', newValue: enabled }] });
    });
  });

  describe('setIdpUserPassword', () => {
    it.each([
      { permanent: undefined, expected: true },
      { permanent: false, expected: false },
    ])('sets the password as permanent=$expected when the request says permanent=$permanent', async ({ permanent, expected }) => {
      await newService().setIdpUserPassword(context(), create(SetIdpUserPasswordRequestSchema, { username: 'alice', password: 'Passw0rd!', permanent }));

      expect(cognitoMock.commandCalls(AdminSetUserPasswordCommand)[0].args[0].input).toEqual({
        UserPoolId: USER_POOL_ID,
        Username:   'alice',
        Password:   'Passw0rd!',
        Permanent:  expected,
      });
    });

    it('records that the password changed, without its value', async () => {
      const ctx = context();

      await newService().setIdpUserPassword(ctx, create(SetIdpUserPasswordRequestSchema, { username: 'alice', password: 'Passw0rd!' }));

      expect(ctx.recordAudit).toHaveBeenCalledWith({ status: 'success', entityId: 'alice', entityName: 'alice', changes: [{ field: 'password' }] });
      expect(JSON.stringify(jest.mocked(ctx.recordAudit).mock.calls)).not.toContain('Passw0rd!');
    });
  });

  describe('deleteIdpUser', () => {
    const request = create(DeleteIdpUserRequestSchema, { username: 'alice' });

    it('deletes the user from the pool and records it in the audit', async () => {
      const ctx = context();

      await newService().deleteIdpUser(ctx, request);

      expect(cognitoMock.commandCalls(AdminDeleteUserCommand)[0].args[0].input).toEqual({ UserPoolId: USER_POOL_ID, Username: 'alice' });
      expect(ctx.recordAudit).toHaveBeenCalledWith({ status: 'success', entityId: 'alice', entityName: 'alice', changes: [{ field: 'user', oldValue: { username: 'alice' } }] });
    });

    it('succeeds when the user is already gone, and still records it in the audit', async () => {
      cognitoMock.on(AdminDeleteUserCommand).rejects(cognitoError('UserNotFoundException'));
      const ctx = context();

      const response = await newService().deleteIdpUser(ctx, request);

      expect(response).toHaveProperty('$typeName');
      expect(ctx.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', entityId: 'alice' }));
    });
  });

  describe('the audit of a change that fails', () => {
    const cognitoFailure = cognitoError('ServiceUnavailableException', 'Cognito is down');

    const changes = [
      {
        name:    'setIdpUserEnabled',
        arrange: () => cognitoMock.on(AdminEnableUserCommand).rejects(cognitoFailure),
        invoke:  (ctx: HandlerContext) => newService().setIdpUserEnabled(ctx, create(SetIdpUserEnabledRequestSchema, { username: 'alice', enabled: true })),
      },
      {
        name:    'setIdpUserPassword',
        arrange: () => cognitoMock.on(AdminSetUserPasswordCommand).rejects(cognitoFailure),
        invoke:  (ctx: HandlerContext) => newService().setIdpUserPassword(ctx, create(SetIdpUserPasswordRequestSchema, { username: 'alice', password: 'Passw0rd!' })),
      },
      {
        name:    'deleteIdpUser',
        arrange: () => cognitoMock.on(AdminDeleteUserCommand).rejects(cognitoFailure),
        invoke:  (ctx: HandlerContext) => newService().deleteIdpUser(ctx, create(DeleteIdpUserRequestSchema, { username: 'alice' })),
      },
    ];

    it.each(changes)('$name records a failure with the message and fails with the original failure', async ({ arrange, invoke }) => {
      arrange();
      const ctx = context();

      const rejection = await invoke(ctx).catch((thrown: unknown) => thrown);

      expect(rejection).toBe(cognitoFailure);
      expect(ctx.recordAudit).toHaveBeenCalledTimes(1);
      expect(ctx.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure', entityId: 'alice', errorMsg: 'Cognito is down' }));
    });

    it.each(changes)('$name logs a failed failure record and still fails with the original failure', async ({ arrange, invoke }) => {
      arrange();
      const ctx = context();
      ctx.recordAudit.mockRejectedValue(new Error('queue unreachable'));

      const rejection = await invoke(ctx).catch((thrown: unknown) => thrown);

      expect(rejection).toBe(cognitoFailure);
      expect(logError).toHaveBeenCalledWith('idp_user_failure_audit_failed', { username: 'alice', error: 'Error: queue unreachable' });
    });

    it('fails the request when the record of a success cannot be written', async () => {
      const ctx          = context();
      const auditFailure = new Error('queue unreachable');
      ctx.recordAudit.mockRejectedValue(auditFailure);

      const rejection = await newService().deleteIdpUser(ctx, create(DeleteIdpUserRequestSchema, { username: 'alice' })).catch((thrown: unknown) => thrown);

      expect(rejection).toBe(auditFailure);
    });
  });

  describe('a request the validator rejects', () => {
    it.each([
      { name: 'listIdpUsers', invoke: (ctx: HandlerContext) => newService().listIdpUsers(ctx, create(ListIdpUsersRequestSchema, { pageSize: 0 })) },
      { name: 'getIdpUser', invoke: (ctx: HandlerContext) => newService().getIdpUser(ctx, create(GetIdpUserRequestSchema, { username: ' ' })) },
      { name: 'createIdpUser', invoke: (ctx: HandlerContext) => newService().createIdpUser(ctx, create(CreateIdpUserRequestSchema, { username: 'alice', password: 'short' })) },
      { name: 'setIdpUserEnabled', invoke: (ctx: HandlerContext) => newService().setIdpUserEnabled(ctx, create(SetIdpUserEnabledRequestSchema, { username: '' })) },
      { name: 'setIdpUserPassword', invoke: (ctx: HandlerContext) => newService().setIdpUserPassword(ctx, create(SetIdpUserPasswordRequestSchema, { username: 'alice', password: 'short' })) },
      { name: 'deleteIdpUser', invoke: (ctx: HandlerContext) => newService().deleteIdpUser(ctx, create(DeleteIdpUserRequestSchema, { username: '' })) },
    ])('$name fails as invalid input before it calls Cognito or records an audit entry', async ({ invoke }) => {
      const ctx = context();

      await expect(invoke(ctx)).rejects.toBeInstanceOf(InvalidInputError);

      expect(cognitoMock.calls()).toHaveLength(0);
      expect(ctx.recordAudit).not.toHaveBeenCalled();
    });
  });

  describe('a Cognito failure', () => {
    interface FailingOperation {
      readonly operation: string;
      readonly invoke:    (service: CognitoIdpUsersService) => Promise<unknown>;
      readonly failWith:  (error: Error) => void;
    }

    const createRequest                        = create(CreateIdpUserRequestSchema, { username: 'alice', password: 'Passw0rd!' });
    const getUser: FailingOperation            = {
      operation: 'getIdpUser',
      invoke:    (service) => service.getIdpUser(context(), create(GetIdpUserRequestSchema, { username: 'alice' })),
      failWith:  (error) => cognitoMock.on(AdminGetUserCommand).rejects(error),
    };
    const setEnabled: FailingOperation         = {
      operation: 'setIdpUserEnabled',
      invoke:    (service) => service.setIdpUserEnabled(context(), create(SetIdpUserEnabledRequestSchema, { username: 'alice', enabled: true })),
      failWith:  (error) => cognitoMock.on(AdminEnableUserCommand).rejects(error),
    };
    const setPassword: FailingOperation        = {
      operation: 'setIdpUserPassword',
      invoke:    (service) => service.setIdpUserPassword(context(), create(SetIdpUserPasswordRequestSchema, { username: 'alice', password: 'Passw0rd!' })),
      failWith:  (error) => cognitoMock.on(AdminSetUserPasswordCommand).rejects(error),
    };
    const createUser: FailingOperation         = {
      operation: 'createIdpUser creating the user',
      invoke:    (service) => service.createIdpUser(context(), createRequest),
      failWith:  (error) => cognitoMock.on(AdminCreateUserCommand).rejects(error),
    };
    const createUserPassword: FailingOperation = {
      operation: 'createIdpUser making the password permanent',
      invoke:    (service) => service.createIdpUser(context(), createRequest),
      failWith:  (error) => cognitoMock.on(AdminSetUserPasswordCommand).rejects(error),
    };
    const deleteUser: FailingOperation         = {
      operation: 'deleteIdpUser',
      invoke:    (service) => service.deleteIdpUser(context(), create(DeleteIdpUserRequestSchema, { username: 'alice' })),
      failWith:  (error) => cognitoMock.on(AdminDeleteUserCommand).rejects(error),
    };

    async function rejectionOf(operation: FailingOperation): Promise<unknown> {
      return operation.invoke(newService()).then(
        () => { throw new Error('expected the operation to reject'); },
        (rejection: unknown) => rejection,
      );
    }

    it.each([getUser, setEnabled, setPassword, createUser, createUserPassword, deleteUser])(
      'is rethrown as it is by $operation when it is not one the service classifies',
      async (operation) => {
        const serviceUnavailable = cognitoError('ServiceUnavailableException');
        operation.failWith(serviceUnavailable);

        expect(await rejectionOf(operation)).toBe(serviceUnavailable);
      },
    );

    it('is rethrown as it is when the thrown value is not an Error, even if it is named like a Cognito failure', async () => {
      const notAnError = { name: 'UserNotFoundException', message: COGNITO_MESSAGE };
      cognitoMock.on(AdminGetUserCommand).callsFake(async () => {
        throw notAnError;
      });

      expect(await rejectionOf(getUser)).toBe(notAnError);
    });

    it.each([
      { operation: getUser, cognitoName: 'UserNotFoundException', becomes: NotFoundError, message: 'User not found' },
      { operation: getUser, cognitoName: 'InvalidParameterException', becomes: InvalidInputError, message: COGNITO_MESSAGE },
      { operation: setEnabled, cognitoName: 'UserNotFoundException', becomes: NotFoundError, message: 'User not found' },
      { operation: setEnabled, cognitoName: 'InvalidParameterException', becomes: InvalidInputError, message: COGNITO_MESSAGE },
      { operation: setPassword, cognitoName: 'UserNotFoundException', becomes: NotFoundError, message: 'User not found' },
      { operation: setPassword, cognitoName: 'InvalidPasswordException', becomes: InvalidInputError, message: COGNITO_MESSAGE },
      { operation: setPassword, cognitoName: 'InvalidParameterException', becomes: InvalidInputError, message: COGNITO_MESSAGE },
      { operation: createUser, cognitoName: 'UsernameExistsException', becomes: ConflictError, message: 'User already exists' },
      { operation: createUser, cognitoName: 'InvalidPasswordException', becomes: InvalidInputError, message: COGNITO_MESSAGE },
      { operation: createUser, cognitoName: 'InvalidParameterException', becomes: InvalidInputError, message: COGNITO_MESSAGE },
      { operation: createUserPassword, cognitoName: 'InvalidPasswordException', becomes: InvalidInputError, message: COGNITO_MESSAGE },
      { operation: createUserPassword, cognitoName: 'InvalidParameterException', becomes: InvalidInputError, message: COGNITO_MESSAGE },
      { operation: deleteUser, cognitoName: 'InvalidParameterException', becomes: InvalidInputError, message: COGNITO_MESSAGE },
    ])('$cognitoName is answered by $operation.operation as $becomes.name', async ({ operation, cognitoName, becomes, message }) => {
      operation.failWith(cognitoError(cognitoName));

      const rejection = await rejectionOf(operation);

      expect(rejection).toBeInstanceOf(becomes);
      expect((rejection as Error).message).toBe(message);
    });
  });
});
