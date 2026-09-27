/// <reference types="jest" />

/**
 * Unit tests for CognitoIdpUsersService — idp-users.service.ts
 *
 * Tests the service's handling of IDP user operations:
 * - deleteIdpUser: successful deletion, idempotent on UserNotFoundException, error handling
 * - deleteIdpUser audit field behavior
 * - Interaction with mocked Cognito SDK client
 */

import { create } from '@bufbuild/protobuf';
import { InvalidInputError } from '@serverlessinbox/mailbox-admin-api';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { CognitoIdpUsersService, type CognitoIdpUsersServiceDeps } from '../idp-users.service';
import { CreateIdpUserRequestSchema, DeleteIdpUserRequestSchema, SetIdpUserPasswordRequestSchema } from '../generated/idp_users_pb';
import type { IdentityProvisionerClient } from '../identity-provisioner-client';

describe('CognitoIdpUsersService', () => {
  let service: CognitoIdpUsersService;
  const testUserPoolId = 'test-pool-123';

  // Mock Cognito client
  let mockCognitoClient: any;
  let mockIdentityProvisioner: jest.Mocked<Pick<IdentityProvisionerClient, 'provisionUser'>>;

  const createMockContext = (overrides?: any) => ({
    auth: {
      accountId: 'test-account',
      principalId: 'test-principal',
      tenantId: 'tenant-123',
    },
    audit: {
      entityId: '',
      entityName: '',
      changes: [],
      ...overrides?.audit,
    },
    ...overrides,
  });

  const makeDeps = (overrides?: Partial<CognitoIdpUsersServiceDeps>): CognitoIdpUsersServiceDeps => ({
    identityProvisioner: mockIdentityProvisioner as unknown as IdentityProvisionerClient,
    adminGroups: ['admin'],
    logger: new LoggerBuffer(undefined, 'error'),
    ...overrides,
  });

  beforeEach(() => {
    // Create a mock Cognito client with a send method
    mockCognitoClient = {
      send: jest.fn(),
    };
    mockIdentityProvisioner = {
      provisionUser: jest.fn().mockResolvedValue({ principalId: 'p1', primaryAccountId: 'a1', isNewUser: true }),
    };

    // Create service with mock client
    service = new CognitoIdpUsersService(mockCognitoClient, testUserPoolId, makeDeps());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('deleteIdpUser', () => {
    it('successfully deletes a user', async () => {
      const req = create(DeleteIdpUserRequestSchema, { username: 'testuser' });
      const ctx = createMockContext();

      mockCognitoClient.send.mockResolvedValueOnce({});

      const result = await service.deleteIdpUser(ctx, req);

      expect(result).toBeDefined();
      expect(mockCognitoClient.send).toHaveBeenCalled();
    });

    it('sets audit fields correctly on deletion', async () => {
      const req = create(DeleteIdpUserRequestSchema, { username: 'testuser@example.com' });
      const ctx = createMockContext();

      mockCognitoClient.send.mockResolvedValueOnce({});

      await service.deleteIdpUser(ctx, req);

      expect(ctx.audit.entityId).toBe('testuser@example.com');
      expect(ctx.audit.entityName).toBe('testuser@example.com');
      expect(ctx.audit.changes).toEqual([
        {
          op: 'remove',
          path: '/user',
          value: { username: 'testuser@example.com' },
        },
      ]);
    });

    it('treats UserNotFoundException as idempotent success', async () => {
      const req = create(DeleteIdpUserRequestSchema, { username: 'nonexistent' });
      const ctx = createMockContext();

      const error = new Error('User not found') as any;
      error.name = 'UserNotFoundException';
      mockCognitoClient.send.mockRejectedValueOnce(error);

      const result = await service.deleteIdpUser(ctx, req);

      expect(result).toBeDefined();
      // Should still set audit fields
      expect(ctx.audit.entityId).toBe('nonexistent');
    });

    it('throws non-UserNotFoundException errors', async () => {
      const req = create(DeleteIdpUserRequestSchema, { username: 'testuser' });
      const ctx = createMockContext();

      const error = new Error('Service unavailable') as any;
      error.name = 'ServiceUnavailableException';
      mockCognitoClient.send.mockRejectedValueOnce(error);

      await expect(service.deleteIdpUser(ctx, req)).rejects.toThrow('Service unavailable');
    });

    it('throws when error has no name property', async () => {
      const req = create(DeleteIdpUserRequestSchema, { username: 'testuser' });
      const ctx = createMockContext();

      const error = { message: 'Unknown error' };
      mockCognitoClient.send.mockRejectedValueOnce(error);

      await expect(service.deleteIdpUser(ctx, req)).rejects.toEqual(error);
    });

    it('handles different user pool IDs correctly', async () => {
      const customPoolId = 'custom-pool-xyz';
      const customService = new CognitoIdpUsersService(mockCognitoClient, customPoolId, makeDeps());

      const req = create(DeleteIdpUserRequestSchema, { username: 'testuser' });
      const ctx = createMockContext();

      mockCognitoClient.send.mockResolvedValueOnce({});

      await customService.deleteIdpUser(ctx, req);

      expect(mockCognitoClient.send).toHaveBeenCalled();
    });

    it('responds with empty response on successful deletion', async () => {
      const req = create(DeleteIdpUserRequestSchema, { username: 'testuser' });
      const ctx = createMockContext();

      mockCognitoClient.send.mockResolvedValueOnce({});

      const result = await service.deleteIdpUser(ctx, req);

      // Result should be a DeleteIdpUserResponse object
      expect(result).toHaveProperty('$typeName');
    });
  });

  describe('createIdpUser', () => {
    const buildRequest = (overrides?: { username?: string; email?: string; groups?: string[] }) =>
      create(CreateIdpUserRequestSchema, {
        username: 'newuser',
        email: 'newuser@example.com',
        password: 'Passw0rd!',
        groups: ['user'],
        ...overrides,
      });

    // Cognito returns `sub` as a UserAttribute on AdminGetUser — deliberately distinct from
    // `username` so a test asserting `subject === sub` cannot pass by accident if the source
    // used `username` instead.
    function mockCognitoCreateFlow(sub: string) {
      mockCognitoClient.send.mockImplementation(async (command: any) => {
        if (command.constructor.name === 'AdminGetUserCommand') {
          return {
            Username: command.input.Username,
            Enabled: true,
            UserAttributes: [{ Name: 'sub', Value: sub }],
          };
        }
        return {};
      });
    }

    it('invokes identity-provisioner with subject = Cognito sub, never the username', async () => {
      mockCognitoCreateFlow('cognito-sub-abc');
      const req = buildRequest({ username: 'newuser', groups: ['user'] });
      const ctx = createMockContext();

      await service.createIdpUser(ctx, req);

      expect(mockIdentityProvisioner.provisionUser).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'cognito-sub-abc',
          username: 'newuser',
          tenantId: 'tenant-123',
          groups: ['user'],
          isAdmin: false,
        }),
      );
      const call = mockIdentityProvisioner.provisionUser.mock.calls[0][0];
      expect(call.subject).not.toBe(call.username);
    });

    it('derives isAdmin from configured admin groups, case-insensitively', async () => {
      mockCognitoCreateFlow('sub-1');
      const req = buildRequest({ username: 'adminuser', groups: ['Admin'] });
      const ctx = createMockContext();

      await service.createIdpUser(ctx, req);

      expect(mockIdentityProvisioner.provisionUser).toHaveBeenCalledWith(
        expect.objectContaining({ isAdmin: true }),
      );
    });

    it('does not fail the RPC when the identity-provisioner invoke fails', async () => {
      mockCognitoCreateFlow('sub-2');
      mockIdentityProvisioner.provisionUser.mockRejectedValueOnce(new Error('AccessDenied'));
      const req = buildRequest({ username: 'newuser2' });
      const ctx = createMockContext();

      const result = await service.createIdpUser(ctx, req);

      expect(result).toBeDefined();
      expect(mockIdentityProvisioner.provisionUser).toHaveBeenCalled();
    });

    it('does not fail the RPC when Cognito never returns a sub', async () => {
      mockCognitoClient.send.mockImplementation(async (command: any) => {
        if (command.constructor.name === 'AdminGetUserCommand') {
          return { Username: command.input.Username, Enabled: true, UserAttributes: [] };
        }
        return {};
      });
      const req = buildRequest({ username: 'newuser3' });
      const ctx = createMockContext();

      const result = await service.createIdpUser(ctx, req);

      expect(result).toBeDefined();
      expect(mockIdentityProvisioner.provisionUser).not.toHaveBeenCalled();
    });

    it('classifies a password-policy rejection on AdminCreateUserCommand as InvalidInputError, preserving the Cognito message', async () => {
      const error = new Error('Password does not conform to policy: Password must have uppercase characters') as any;
      error.name = 'InvalidPasswordException';
      mockCognitoClient.send.mockRejectedValueOnce(error);
      const req = buildRequest({ username: 'newuser4' });
      const ctx = createMockContext();

      const thrown = await service.createIdpUser(ctx, req).then(
        () => { throw new Error('expected createIdpUser to reject'); },
        (e) => e,
      );

      expect(thrown).toBeInstanceOf(InvalidInputError);
      expect(thrown.message).toBe('Password does not conform to policy: Password must have uppercase characters');
    });

    it('classifies a malformed-attribute rejection on AdminCreateUserCommand as InvalidInputError, preserving the Cognito message', async () => {
      const error = new Error('Invalid email address format.') as any;
      error.name = 'InvalidParameterException';
      mockCognitoClient.send.mockRejectedValueOnce(error);
      const req = buildRequest({ username: 'newuser5' });
      const ctx = createMockContext();

      const thrown = await service.createIdpUser(ctx, req).then(
        () => { throw new Error('expected createIdpUser to reject'); },
        (e) => e,
      );

      expect(thrown).toBeInstanceOf(InvalidInputError);
      expect(thrown.message).toBe('Invalid email address format.');
    });

    it('classifies a password-policy rejection on the AdminSetUserPasswordCommand step as InvalidInputError', async () => {
      const error = new Error('Password does not conform to policy: Password not long enough') as any;
      error.name = 'InvalidPasswordException';
      mockCognitoClient.send.mockImplementation(async (command: any) => {
        if (command.constructor.name === 'AdminSetUserPasswordCommand') {
          throw error;
        }
        return {};
      });
      const req = buildRequest({ username: 'newuser6' });
      const ctx = createMockContext();

      const thrown = await service.createIdpUser(ctx, req).then(
        () => { throw new Error('expected createIdpUser to reject'); },
        (e) => e,
      );

      expect(thrown).toBeInstanceOf(InvalidInputError);
      expect(thrown.message).toBe('Password does not conform to policy: Password not long enough');
    });
  });

  describe('setIdpUserPassword', () => {
    const buildRequest = (overrides?: { username?: string; password?: string }) =>
      create(SetIdpUserPasswordRequestSchema, {
        username: 'existinguser',
        password: 'Passw0rd!',
        permanent: true,
        ...overrides,
      });

    it('classifies InvalidPasswordException as InvalidInputError, preserving the Cognito message', async () => {
      const error = new Error('Password does not conform to policy: Password must have symbol characters') as any;
      error.name = 'InvalidPasswordException';
      mockCognitoClient.send.mockRejectedValueOnce(error);
      const req = buildRequest();
      const ctx = createMockContext();

      const thrown = await service.setIdpUserPassword(ctx, req).then(
        () => { throw new Error('expected setIdpUserPassword to reject'); },
        (e) => e,
      );

      expect(thrown).toBeInstanceOf(InvalidInputError);
      expect(thrown.message).toBe('Password does not conform to policy: Password must have symbol characters');
    });

    it('classifies InvalidParameterException as InvalidInputError, preserving the Cognito message', async () => {
      const error = new Error('1 validation error detected: Value at Password failed to satisfy constraint') as any;
      error.name = 'InvalidParameterException';
      mockCognitoClient.send.mockRejectedValueOnce(error);
      const req = buildRequest();
      const ctx = createMockContext();

      const thrown = await service.setIdpUserPassword(ctx, req).then(
        () => { throw new Error('expected setIdpUserPassword to reject'); },
        (e) => e,
      );

      expect(thrown).toBeInstanceOf(InvalidInputError);
      expect(thrown.message).toBe('1 validation error detected: Value at Password failed to satisfy constraint');
    });

    it('still classifies UserNotFoundException as NotFoundError, not InvalidInputError', async () => {
      const error = new Error('User not found') as any;
      error.name = 'UserNotFoundException';
      mockCognitoClient.send.mockRejectedValueOnce(error);
      const req = buildRequest();
      const ctx = createMockContext();

      await expect(service.setIdpUserPassword(ctx, req)).rejects.not.toBeInstanceOf(InvalidInputError);
    });
  });
});
