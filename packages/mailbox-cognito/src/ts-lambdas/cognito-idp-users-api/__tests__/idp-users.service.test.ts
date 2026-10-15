/// <reference types="jest" />

/**
 * Pins what the user service asks of Cognito for each request, how it answers a Cognito failure, and what it
 * records on the audit context. The admin API turns the error class the service throws into the HTTP status,
 * so a failure classified as the wrong class answers the caller with the wrong status; the audit fields are all
 * the audit trail knows of a request. Creating a user also pre-provisions its mailbox principal, which must
 * never fail the creation.
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
import { create } from '@bufbuild/protobuf';
import { mockClient } from 'aws-sdk-client-mock';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  type AdminAuthContext,
  type AuditContext,
  type HandlerContext,
} from '@serverlessinbox/mailbox-admin-api';
import { LoggerBuffer, toAccountId, toFunctionName } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { toGroupName, toUserPoolId, type GroupName } from '../../shared/cognito-identifiers';
import { toPrincipalId } from '../../shared/identity-identifiers';
import { IdentityProvisionerClient } from '../../shared/identity-provisioner-client';
import {
  CreateIdpUserRequestSchema,
  DeleteIdpUserRequestSchema,
  GetIdpUserRequestSchema,
  ListIdpUsersRequestSchema,
  SetIdpUserEnabledRequestSchema,
  SetIdpUserPasswordRequestSchema,
} from '../generated/idp_users_pb';
import { IdpUserMapper } from '../idp-user-mapper';
import { CognitoIdpUsersService } from '../idp-users.service';

type IdpUsersContext = HandlerContext<AdminAuthContext, AuditContext>;

const USER_POOL_ID = 'pool-1';
const TENANT_ID = 'tenant-123';
const COGNITO_MESSAGE = 'Cognito said so';

function context(): IdpUsersContext {
  return {
    auth: { authType: 'authenticated', sub: 'caller-sub', groups: [], isAdmin: true, roles: ['admin'], scopes: [], tenantId: TENANT_ID, raw: {} },
    audit: { entityType: 'idp-users', action: 'IdpUsersService/Test' },
  };
}

function cognitoError(name: string, message: string = COGNITO_MESSAGE): Error {
  return Object.assign(new Error(message), { name });
}

describe('CognitoIdpUsersService', () => {
  const cognitoMock = mockClient(CognitoIdentityProviderClient);
  const logger = new LoggerBuffer(undefined, 'error');
  const identityProvisioner = new IdentityProvisionerClient(toFunctionName('identity-provisioner'), new LambdaClient({}));
  const provisionUser = jest.spyOn(identityProvisioner, 'provisionUser');
  const logError = jest.spyOn(logger, 'error');
  const flushLogs = jest.spyOn(logger, 'flush');

  function newService(adminGroups: GroupName[] = [toGroupName('admin')]): CognitoIdpUsersService {
    return new CognitoIdpUsersService(new CognitoIdentityProviderClient({}), toUserPoolId(USER_POOL_ID), {
      identityProvisioner,
      userMapper: new IdpUserMapper(),
      adminGroups,
      logger,
    });
  }

  beforeEach(() => {
    cognitoMock.reset();
    cognitoMock.onAnyCommand().resolves({});
    provisionUser.mockReset().mockResolvedValue({ principalId: toPrincipalId('p1'), primaryAccountId: toAccountId('a1'), isNewUser: true });
    logError.mockReset().mockImplementation(() => undefined);
    flushLogs.mockClear();
  });

  describe('listIdpUsers', () => {
    it('lists the users of the pool page by page and returns the next page token', async () => {
      cognitoMock.on(ListUsersCommand).resolves({ Users: [{ Username: 'alice', Enabled: true }], PaginationToken: 'next-page' });
      const request = create(ListIdpUsersRequestSchema, { pageSize: 10, pageToken: 'this-page', filter: 'username ^= "al"' });

      const response = await newService().listIdpUsers(context(), request);

      expect(cognitoMock.commandCalls(ListUsersCommand)[0].args[0].input).toEqual({
        UserPoolId: USER_POOL_ID,
        Limit: 10,
        PaginationToken: 'this-page',
        Filter: 'username ^= "al"',
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
    it('returns the user and records it as the audited entity', async () => {
      cognitoMock.on(AdminGetUserCommand).resolves({ Username: 'alice', Enabled: true, UserAttributes: [{ Name: 'email', Value: 'alice@example.com' }] });
      const ctx = context();

      const response = await newService().getIdpUser(ctx, create(GetIdpUserRequestSchema, { username: 'alice' }));

      expect(cognitoMock.commandCalls(AdminGetUserCommand)[0].args[0].input).toEqual({ UserPoolId: USER_POOL_ID, Username: 'alice' });
      expect(response.user?.attributes).toEqual({ email: 'alice@example.com' });
      expect([ctx.audit.entityId, ctx.audit.entityName]).toEqual(['alice', 'alice']);
    });
  });

  describe('createIdpUser', () => {
    const request = (overrides: { email?: string; enabled?: boolean; groups?: string[] } = {}) =>
      create(CreateIdpUserRequestSchema, { username: 'newuser', email: 'newuser@example.com', password: 'Passw0rd!', groups: ['user'], ...overrides });

    // The sub is deliberately unlike the username, so an assertion on the subject cannot pass if the username is used for it.
    function cognitoReturnsUser(user: { enabled?: boolean; sub?: string } = {}): void {
      cognitoMock.on(AdminGetUserCommand).resolves({
        Username: 'newuser',
        Enabled: user.enabled,
        UserAttributes: user.sub ? [{ Name: 'sub', Value: user.sub }] : [],
      });
    }

    it('creates the user without sending a message, then makes its password permanent', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });

      await newService().createIdpUser(context(), request());

      expect(cognitoMock.commandCalls(AdminCreateUserCommand)[0].args[0].input).toEqual({
        UserPoolId: USER_POOL_ID,
        Username: 'newuser',
        TemporaryPassword: 'Passw0rd!',
        MessageAction: 'SUPPRESS',
        UserAttributes: [{ Name: 'email', Value: 'newuser@example.com' }],
      });
      expect(cognitoMock.commandCalls(AdminSetUserPasswordCommand)[0].args[0].input).toEqual({
        UserPoolId: USER_POOL_ID,
        Username: 'newuser',
        Password: 'Passw0rd!',
        Permanent: true,
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

    it('adds the user to each requested group, and to the group user when none is requested', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });

      await newService().createIdpUser(context(), request({ groups: ['staff', 'finance'] }));
      await newService().createIdpUser(context(), request({ groups: [] }));

      expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand).map((call) => call.args[0].input.GroupName)).toEqual(['staff', 'finance', 'user']);
    });

    it('still creates the user when adding it to a group fails', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });
      cognitoMock.on(AdminAddUserToGroupCommand).rejects(cognitoError('ResourceNotFoundException', 'Group not found'));

      const response = await newService().createIdpUser(context(), request());

      expect(response.user?.username).toBe('newuser');
    });

    it('reports the requested enabled state when Cognito reports none for the created user', async () => {
      cognitoReturnsUser({ enabled: undefined, sub: 'cognito-sub-abc' });

      const response = await newService().createIdpUser(context(), request());

      expect(response.user?.enabled).toBe(true);
    });

    it('records the created user and what was requested on the audit context', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });
      const ctx = context();

      await newService().createIdpUser(ctx, request({ enabled: false }));

      expect([ctx.audit.entityId, ctx.audit.entityName]).toEqual(['newuser', 'newuser@example.com']);
      expect(ctx.audit.changes).toEqual([
        { op: 'create', path: '/user', value: { username: 'newuser', email: 'newuser@example.com', enabled: false, groups: ['user'] } },
      ]);
    });

    it('provisions the mailbox principal under the Cognito sub, never the username', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });

      await newService().createIdpUser(context(), request());

      expect(provisionUser).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        subject: 'cognito-sub-abc',
        username: 'newuser',
        email: 'newuser@example.com',
        groups: ['user'],
        isAdmin: false,
      });
    });

    it('provisions an admin when a group of the user is an admin group, whatever the case', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });

      await newService([toGroupName('admin')]).createIdpUser(context(), request({ groups: ['Admin'] }));

      expect(provisionUser).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }));
    });

    it('still creates the user when provisioning fails, and logs the failure without flushing the log', async () => {
      cognitoReturnsUser({ sub: 'cognito-sub-abc' });
      provisionUser.mockRejectedValueOnce(new Error('AccessDenied'));

      const response = await newService().createIdpUser(context(), request());

      expect(response.user?.username).toBe('newuser');
      expect(logError).toHaveBeenCalledWith('idp_user_provision_invoke_failed', { username: 'newuser', error: 'Error: AccessDenied' });
      expect(flushLogs).not.toHaveBeenCalled();
    });

    it('still creates the user when Cognito reports no sub, and does not provision it', async () => {
      cognitoReturnsUser({});

      const response = await newService().createIdpUser(context(), request());

      expect(response.user?.username).toBe('newuser');
      expect(provisionUser).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalledWith('idp_user_provision_missing_sub', { username: 'newuser' });
      expect(flushLogs).not.toHaveBeenCalled();
    });
  });

  describe('setIdpUserEnabled', () => {
    it.each([
      { enabled: true, called: AdminEnableUserCommand, notCalled: AdminDisableUserCommand },
      { enabled: false, called: AdminDisableUserCommand, notCalled: AdminEnableUserCommand },
    ])('sends the command that sets enabled=$enabled and records it on the audit context', async ({ enabled, called, notCalled }) => {
      const ctx = context();

      await newService().setIdpUserEnabled(ctx, create(SetIdpUserEnabledRequestSchema, { username: 'alice', enabled }));

      expect(cognitoMock.commandCalls(called)[0].args[0].input).toEqual({ UserPoolId: USER_POOL_ID, Username: 'alice' });
      expect(cognitoMock.commandCalls(notCalled)).toHaveLength(0);
      expect([ctx.audit.entityId, ctx.audit.entityName]).toEqual(['alice', 'alice']);
      expect(ctx.audit.changes).toEqual([{ op: 'replace', path: '/enabled', value: enabled }]);
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
        Username: 'alice',
        Password: 'Passw0rd!',
        Permanent: expected,
      });
    });

    it('never records the password on the audit context', async () => {
      const ctx = context();

      await newService().setIdpUserPassword(ctx, create(SetIdpUserPasswordRequestSchema, { username: 'alice', password: 'Passw0rd!' }));

      expect(ctx.audit.changes).toEqual([{ op: 'replace', path: '/password', value: '***' }]);
    });
  });

  describe('deleteIdpUser', () => {
    const request = create(DeleteIdpUserRequestSchema, { username: 'alice' });

    it('deletes the user from the pool and records it on the audit context', async () => {
      const ctx = context();

      await newService().deleteIdpUser(ctx, request);

      expect(cognitoMock.commandCalls(AdminDeleteUserCommand)[0].args[0].input).toEqual({ UserPoolId: USER_POOL_ID, Username: 'alice' });
      expect([ctx.audit.entityId, ctx.audit.entityName]).toEqual(['alice', 'alice']);
      expect(ctx.audit.changes).toEqual([{ op: 'remove', path: '/user', value: { username: 'alice' } }]);
    });

    it('succeeds when the user is already gone, and still records it on the audit context', async () => {
      cognitoMock.on(AdminDeleteUserCommand).rejects(cognitoError('UserNotFoundException'));
      const ctx = context();

      const response = await newService().deleteIdpUser(ctx, request);

      expect(response).toHaveProperty('$typeName');
      expect(ctx.audit.entityId).toBe('alice');
    });
  });

  describe('a Cognito failure', () => {
    interface FailingOperation {
      readonly operation: string;
      readonly invoke: (service: CognitoIdpUsersService) => Promise<unknown>;
      readonly failWith: (error: Error) => void;
    }

    const createRequest = create(CreateIdpUserRequestSchema, { username: 'alice', password: 'Passw0rd!' });
    const getUser: FailingOperation = {
      operation: 'getIdpUser',
      invoke: (service) => service.getIdpUser(context(), create(GetIdpUserRequestSchema, { username: 'alice' })),
      failWith: (error) => cognitoMock.on(AdminGetUserCommand).rejects(error),
    };
    const setEnabled: FailingOperation = {
      operation: 'setIdpUserEnabled',
      invoke: (service) => service.setIdpUserEnabled(context(), create(SetIdpUserEnabledRequestSchema, { username: 'alice', enabled: true })),
      failWith: (error) => cognitoMock.on(AdminEnableUserCommand).rejects(error),
    };
    const setPassword: FailingOperation = {
      operation: 'setIdpUserPassword',
      invoke: (service) => service.setIdpUserPassword(context(), create(SetIdpUserPasswordRequestSchema, { username: 'alice', password: 'Passw0rd!' })),
      failWith: (error) => cognitoMock.on(AdminSetUserPasswordCommand).rejects(error),
    };
    const createUser: FailingOperation = {
      operation: 'createIdpUser creating the user',
      invoke: (service) => service.createIdpUser(context(), createRequest),
      failWith: (error) => cognitoMock.on(AdminCreateUserCommand).rejects(error),
    };
    const createUserPassword: FailingOperation = {
      operation: 'createIdpUser making the password permanent',
      invoke: (service) => service.createIdpUser(context(), createRequest),
      failWith: (error) => cognitoMock.on(AdminSetUserPasswordCommand).rejects(error),
    };
    const deleteUser: FailingOperation = {
      operation: 'deleteIdpUser',
      invoke: (service) => service.deleteIdpUser(context(), create(DeleteIdpUserRequestSchema, { username: 'alice' })),
      failWith: (error) => cognitoMock.on(AdminDeleteUserCommand).rejects(error),
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
