/// <reference types="jest" />

/**
 * Unit tests for IdpUsersRequestValidator — idp-users.validation.ts
 *
 * Tests validation of IDP user request types:
 * - validateDeleteIdpUser: rejects empty/missing username, accepts valid requests
 * - Error messages are clear and consistent
 */

import { create } from '@bufbuild/protobuf';
import { IdpUsersRequestValidator } from '../idp-users.validation';
import { InvalidInputError } from '@serverlessinbox/mailbox-admin-api';
import { DeleteIdpUserRequestSchema } from '../generated/idp_users_pb';

describe('IdpUsersRequestValidator', () => {
  let validator: IdpUsersRequestValidator;

  beforeEach(() => {
    validator = new IdpUsersRequestValidator();
  });

  describe('validateDeleteIdpUser', () => {
    it('accepts valid request with username', () => {
      const req = create(DeleteIdpUserRequestSchema, { username: 'testuser' });

      expect(() => validator.validateDeleteIdpUser(req)).not.toThrow();
    });

    it('accepts request with email-like username', () => {
      const req = create(DeleteIdpUserRequestSchema, { username: 'user@example.com' });

      expect(() => validator.validateDeleteIdpUser(req)).not.toThrow();
    });

    it('rejects request with empty string username', () => {
      const req = create(DeleteIdpUserRequestSchema, { username: '' });

      expect(() => validator.validateDeleteIdpUser(req)).toThrow(InvalidInputError);
      expect(() => validator.validateDeleteIdpUser(req)).toThrow('Missing/invalid username');
    });

    it('rejects request with whitespace-only username', () => {
      const req = create(DeleteIdpUserRequestSchema, { username: '   ' });

      expect(() => validator.validateDeleteIdpUser(req)).toThrow(InvalidInputError);
      expect(() => validator.validateDeleteIdpUser(req)).toThrow('Missing/invalid username');
    });

    it('rejects request with undefined username', () => {
      const req = create(DeleteIdpUserRequestSchema, { username: undefined });

      expect(() => validator.validateDeleteIdpUser(req)).toThrow(InvalidInputError);
      expect(() => validator.validateDeleteIdpUser(req)).toThrow('Missing/invalid username');
    });

    it('rejects completely empty request', () => {
      const req = create(DeleteIdpUserRequestSchema, {});

      expect(() => validator.validateDeleteIdpUser(req)).toThrow(InvalidInputError);
      expect(() => validator.validateDeleteIdpUser(req)).toThrow('Missing/invalid username');
    });

    it('rejects null username', () => {
      const req = create(DeleteIdpUserRequestSchema, { username: null as any });

      expect(() => validator.validateDeleteIdpUser(req)).toThrow(InvalidInputError);
    });

    it('accepts username with special characters', () => {
      const req = create(DeleteIdpUserRequestSchema, { username: 'user+test@example.com' });

      expect(() => validator.validateDeleteIdpUser(req)).not.toThrow();
    });

    it('accepts username with numbers and hyphens', () => {
      const req = create(DeleteIdpUserRequestSchema, { username: 'user-123_test.456' });

      expect(() => validator.validateDeleteIdpUser(req)).not.toThrow();
    });
  });
});
