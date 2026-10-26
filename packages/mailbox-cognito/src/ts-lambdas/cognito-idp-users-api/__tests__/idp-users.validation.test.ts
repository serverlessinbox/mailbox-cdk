/// <reference types="jest" />

/**
 * Pins which decoded IdP user requests the API accepts and which it rejects as invalid input, which the service
 * wrapper answers with a 400. A request that slipped through would reach Cognito with an empty username or a
 * weak password, and one rejected wrongly would block an admin from managing a user.
 */

import { create }                   from '@bufbuild/protobuf';
import { InvalidInputError }        from '@serverlessinbox/mailbox-addon-sdk';

import {
  CreateIdpUserRequestSchema,
  DeleteIdpUserRequestSchema,
  GetIdpUserRequestSchema,
  ListIdpUsersRequestSchema,
  SetIdpUserEnabledRequestSchema,
  SetIdpUserPasswordRequestSchema,
} from '../generated/idp_users_pb';
import { IdpUsersRequestValidator } from '../idp-users.validation';

describe('IdpUsersRequestValidator', () => {
  const validator = new IdpUsersRequestValidator();

  describe('the username of a request that names a user', () => {
    const namedUserCases = [
      { name: 'validateGetIdpUser', validate: (username: string) => validator.validateGetIdpUser(create(GetIdpUserRequestSchema, { username })) },
      { name: 'validateSetIdpUserEnabled', validate: (username: string) => validator.validateSetIdpUserEnabled(create(SetIdpUserEnabledRequestSchema, { username })) },
      { name: 'validateDeleteIdpUser', validate: (username: string) => validator.validateDeleteIdpUser(create(DeleteIdpUserRequestSchema, { username })) },
    ];

    it.each(namedUserCases)('$name accepts a username, whatever characters it has', ({ validate }) => {
      expect(() => validate('user+test@example.com')).not.toThrow();
    });

    it.each(namedUserCases)('$name rejects an empty or blank username', ({ validate }) => {
      for (const username of ['', '   ']) {
        expect(() => validate(username)).toThrow(new InvalidInputError('Missing/invalid username'));
      }
    });
  });

  describe('validateListIdpUsers', () => {
    it('accepts a request without paging arguments and one with them', () => {
      expect(() => validator.validateListIdpUsers(create(ListIdpUsersRequestSchema, {}))).not.toThrow();
      expect(() => validator.validateListIdpUsers(create(ListIdpUsersRequestSchema, { pageSize: 50, pageToken: 'token', filter: 'username ^= "a"' }))).not.toThrow();
    });

    it.each([1, 1000])('accepts the page size %d at the edge of the range', (pageSize) => {
      expect(() => validator.validateListIdpUsers(create(ListIdpUsersRequestSchema, { pageSize }))).not.toThrow();
    });

    it.each([0, 1001])('rejects the page size %d', (pageSize) => {
      expect(() => validator.validateListIdpUsers(create(ListIdpUsersRequestSchema, { pageSize }))).toThrow(new InvalidInputError('pageSize must be an integer between 1 and 1000'));
    });

    it('rejects a page token longer than 2048 characters and accepts one of exactly 2048', () => {
      expect(() => validator.validateListIdpUsers(create(ListIdpUsersRequestSchema, { pageToken: 'x'.repeat(2048) }))).not.toThrow();
      expect(() => validator.validateListIdpUsers(create(ListIdpUsersRequestSchema, { pageToken: 'x'.repeat(2049) }))).toThrow(new InvalidInputError('pageToken too long'));
    });
  });

  describe('validateCreateIdpUser', () => {
    it('accepts a request with a username and a password of exactly 8 characters', () => {
      expect(() => validator.validateCreateIdpUser(create(CreateIdpUserRequestSchema, { username: 'alice', password: '12345678' }))).not.toThrow();
    });

    it('rejects a missing username before it looks at the password', () => {
      expect(() => validator.validateCreateIdpUser(create(CreateIdpUserRequestSchema, { password: 'Passw0rd!' }))).toThrow(new InvalidInputError('Missing/invalid username'));
    });

    it('rejects a missing or short password', () => {
      for (const password of ['', '1234567']) {
        expect(() => validator.validateCreateIdpUser(create(CreateIdpUserRequestSchema, { username: 'alice', password }))).toThrow(new InvalidInputError('Missing/invalid password'));
      }
    });
  });

  describe('validateSetIdpUserPassword', () => {
    it('accepts a username with a password of 8 characters or more', () => {
      expect(() => validator.validateSetIdpUserPassword(create(SetIdpUserPasswordRequestSchema, { username: 'alice', password: '12345678' }))).not.toThrow();
    });

    it('rejects a missing username, and a missing or short password', () => {
      expect(() => validator.validateSetIdpUserPassword(create(SetIdpUserPasswordRequestSchema, { password: '12345678' }))).toThrow(new InvalidInputError('Missing/invalid username'));
      for (const password of ['', '1234567']) {
        expect(() => validator.validateSetIdpUserPassword(create(SetIdpUserPasswordRequestSchema, { username: 'alice', password }))).toThrow(new InvalidInputError('Missing/invalid password'));
      }
    });
  });
});
