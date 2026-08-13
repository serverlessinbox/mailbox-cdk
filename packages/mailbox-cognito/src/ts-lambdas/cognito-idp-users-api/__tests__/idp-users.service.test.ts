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
import { CognitoIdpUsersService } from '../idp-users.service';
import { DeleteIdpUserRequestSchema } from '../generated/idp_users_pb';

describe('CognitoIdpUsersService', () => {
  let service: CognitoIdpUsersService;
  const testUserPoolId = 'test-pool-123';

  // Mock Cognito client
  let mockCognitoClient: any;

  const createMockContext = (overrides?: any) => ({
    auth: {
      accountId: 'test-account',
      principalId: 'test-principal',
    },
    audit: {
      entityId: '',
      entityName: '',
      changes: [],
      ...overrides?.audit,
    },
    ...overrides,
  });

  beforeEach(() => {
    // Create a mock Cognito client with a send method
    mockCognitoClient = {
      send: jest.fn(),
    };

    // Create service with mock client
    service = new CognitoIdpUsersService(mockCognitoClient, testUserPoolId);
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
      const customService = new CognitoIdpUsersService(mockCognitoClient, customPoolId);

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
});
