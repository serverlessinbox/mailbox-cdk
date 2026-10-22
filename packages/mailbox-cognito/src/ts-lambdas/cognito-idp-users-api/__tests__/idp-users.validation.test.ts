/// <reference types="jest" />

/**
 * Pins which request bodies the IdP user API accepts and which it rejects as invalid input, which the admin API
 * answers with a 400. A body that slipped through would reach Cognito with a field of the wrong type or an empty
 * username, and one rejected wrongly would block an admin from managing a user.
 */

import { InvalidInputError }        from '@serverlessinbox/mailbox-admin-api';

import { IdpUsersRequestValidator } from '../idp-users.validation';

describe('IdpUsersRequestValidator', () => {
  const validator = new IdpUsersRequestValidator();

  describe('the username of a request that names a user', () => {
    it.each([
      { name: 'validateGetIdpUser', validate: validator.validateGetIdpUser },
      { name: 'validateSetIdpUserEnabled', validate: validator.validateSetIdpUserEnabled },
      { name: 'validateDeleteIdpUser', validate: validator.validateDeleteIdpUser },
    ])('$name accepts a username, whatever characters it has', ({ validate }) => {
      expect(validate({ username: 'user+test@example.com' }).username).toBe('user+test@example.com');
    });

    it.each([
      { name: 'validateGetIdpUser', validate: validator.validateGetIdpUser },
      { name: 'validateSetIdpUserEnabled', validate: validator.validateSetIdpUserEnabled },
      { name: 'validateDeleteIdpUser', validate: validator.validateDeleteIdpUser },
    ])('$name rejects a missing, empty or blank username', ({ validate }) => {
      for (const body of [undefined, null, {}, { username: '' }, { username: '   ' }]) {
        expect(() => validate(body)).toThrow(new InvalidInputError('Missing/invalid username'));
      }
    });

    it('validateSetIdpUserEnabled carries the enabled flag into the message', () => {
      expect(validator.validateSetIdpUserEnabled({ username: 'alice', enabled: true }).enabled).toBe(true);
    });
  });

  describe('validateListIdpUsers', () => {
    it('accepts a missing body and a body with paging arguments', () => {
      expect(validator.validateListIdpUsers(undefined).pageSize).toBeUndefined();
      expect(validator.validateListIdpUsers({ pageSize: 50, pageToken: 'token', filter: 'username ^= "a"' })).toMatchObject({
        pageSize:  50,
        pageToken: 'token',
        filter:    'username ^= "a"',
      });
    });

    it.each([1, 1000])('accepts the page size %d at the edge of the range', (pageSize) => {
      expect(validator.validateListIdpUsers({ pageSize }).pageSize).toBe(pageSize);
    });

    it.each([0, 1001, 1.5])('rejects the page size %d', (pageSize) => {
      expect(() => validator.validateListIdpUsers({ pageSize })).toThrow(new InvalidInputError('pageSize must be an integer between 1 and 1000'));
    });

    it('rejects a page token longer than 2048 characters and accepts one of exactly 2048', () => {
      expect(validator.validateListIdpUsers({ pageToken: 'x'.repeat(2048) }).pageToken).toHaveLength(2048);
      expect(() => validator.validateListIdpUsers({ pageToken: 'x'.repeat(2049) })).toThrow(new InvalidInputError('pageToken too long'));
    });
  });

  describe('validateCreateIdpUser', () => {
    it('turns a valid body into the request, with the optional fields it does not have left unset', () => {
      const request = validator.validateCreateIdpUser({ username: 'alice', email: 'alice@example.com', password: 'Passw0rd!', enabled: false, groups: ['staff'] });

      expect(request).toMatchObject({ username: 'alice', email: 'alice@example.com', password: 'Passw0rd!', enabled: false, groups: ['staff'] });

      const minimal = validator.validateCreateIdpUser({ username: 'alice', password: 'Passw0rd!' });
      expect([minimal.email, minimal.enabled, minimal.groups]).toEqual([undefined, undefined, []]);
    });

    it('rejects a missing username before it looks at the password', () => {
      expect(() => validator.validateCreateIdpUser({ password: 'Passw0rd!' })).toThrow(new InvalidInputError('Missing/invalid username'));
    });

    it('accepts a password of exactly 8 characters and rejects a shorter or missing one', () => {
      expect(validator.validateCreateIdpUser({ username: 'alice', password: '12345678' }).password).toBe('12345678');
      for (const password of [undefined, '', '1234567']) {
        expect(() => validator.validateCreateIdpUser({ username: 'alice', password })).toThrow(new InvalidInputError('Missing/invalid password'));
      }
    });
  });

  describe('validateSetIdpUserPassword', () => {
    it('accepts a username with a password of 8 characters or more, and the permanent flag', () => {
      expect(validator.validateSetIdpUserPassword({ username: 'alice', password: '12345678', permanent: false })).toMatchObject({ permanent: false });
    });

    it('rejects a missing username, and a missing or short password', () => {
      expect(() => validator.validateSetIdpUserPassword({ password: '12345678' })).toThrow(new InvalidInputError('Missing/invalid username'));
      for (const password of [undefined, '1234567']) {
        expect(() => validator.validateSetIdpUserPassword({ username: 'alice', password })).toThrow(new InvalidInputError('Missing/invalid password'));
      }
    });
  });

  describe('a body whose fields have the wrong type', () => {
    it.each([
      { name: 'validateListIdpUsers', validate: validator.validateListIdpUsers, body: { pageSize: '10' }, mentions: 'pageSize' },
      { name: 'validateGetIdpUser', validate: validator.validateGetIdpUser, body: { username: 42 }, mentions: 'username' },
      { name: 'validateCreateIdpUser', validate: validator.validateCreateIdpUser, body: { username: 'alice', password: 'Passw0rd!', groups: ['staff', 1] }, mentions: 'groups' },
      { name: 'validateSetIdpUserEnabled', validate: validator.validateSetIdpUserEnabled, body: { username: 'alice', enabled: 'yes' }, mentions: 'enabled' },
      { name: 'validateSetIdpUserPassword', validate: validator.validateSetIdpUserPassword, body: { username: 'alice', password: 'Passw0rd!', permanent: 1 }, mentions: 'permanent' },
      { name: 'validateDeleteIdpUser', validate: validator.validateDeleteIdpUser, body: 'alice', mentions: 'object' },
    ])('$name rejects it as invalid input naming the problem', ({ validate, body, mentions }) => {
      expect(() => validate(body)).toThrow(InvalidInputError);
      expect(() => validate(body)).toThrow(new RegExp(`^Invalid request body: .*${mentions}`));
    });
  });
});
