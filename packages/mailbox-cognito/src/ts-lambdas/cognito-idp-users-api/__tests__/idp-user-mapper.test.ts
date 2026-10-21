/// <reference types="jest" />

/**
 * Pins how the users Cognito reports become the `IdpUser` the API returns, including what a user missing a
 * field is reported as: the admin UI renders these values as they come, so a swapped timestamp, a lost
 * attribute or a wrong enabled flag is shown to the admin as fact.
 */

import { toUsername }    from '../../../runtime/shared/cognito-identifiers';
import { IdpUserMapper } from '../idp-user-mapper';

const CREATED  = new Date(1_000_000);
const MODIFIED = new Date(2_000_000);

describe('IdpUserMapper', () => {
  const mapper = new IdpUserMapper();

  describe('fromListedUser', () => {
    it('maps every field of a listed user', () => {
      const user = mapper.fromListedUser({
        Username: 'alice',
        Enabled: true,
        UserStatus: 'CONFIRMED',
        UserCreateDate: CREATED,
        UserLastModifiedDate: MODIFIED,
        Attributes: [{ Name: 'email', Value: 'alice@example.com' }],
      });

      expect(user).toMatchObject({
        username: 'alice',
        enabled: true,
        userStatus: 'CONFIRMED',
        attributes: { email: 'alice@example.com' },
      });
      expect([Number(user.createdAt?.seconds), Number(user.modifiedAt?.seconds)]).toEqual([1000, 2000]);
    });

    it('names a listed user without a username unknown, reports it disabled, and leaves out what is missing', () => {
      const user = mapper.fromListedUser({});

      expect(user.username).toBe('unknown');
      expect(user.enabled).toBe(false);
      expect(user.createdAt).toBeUndefined();
      expect(user.modifiedAt).toBeUndefined();
      expect(user.attributes).toEqual({});
    });

    it('keeps only the attributes that have a name and a string value', () => {
      const user = mapper.fromListedUser({
        Username: 'alice',
        Attributes: [{ Name: 'email', Value: 'alice@example.com' }, { Name: 'nickname' }, { Name: '', Value: 'unnamed' }],
      });

      expect(user.attributes).toEqual({ email: 'alice@example.com' });
    });
  });

  describe('fromFetchedUser', () => {
    it('maps every field of a fetched user, reading its attributes from UserAttributes', () => {
      const user = mapper.fromFetchedUser(
        {
          Username: 'alice',
          Enabled: false,
          UserStatus: 'FORCE_CHANGE_PASSWORD',
          UserCreateDate: CREATED,
          UserLastModifiedDate: MODIFIED,
          UserAttributes: [{ Name: 'sub', Value: 'sub-1' }],
        },
        toUsername('requested'),
      );

      expect(user).toMatchObject({
        username: 'alice',
        enabled: false,
        userStatus: 'FORCE_CHANGE_PASSWORD',
        attributes: { sub: 'sub-1' },
      });
      expect([Number(user.createdAt?.seconds), Number(user.modifiedAt?.seconds)]).toEqual([1000, 2000]);
    });

    it('takes the requested username when Cognito reports none', () => {
      expect(mapper.fromFetchedUser({}, toUsername('requested')).username).toBe('requested');
    });

    it.each([
      { reported: true, fallback: false, expected: true },
      { reported: undefined, fallback: true, expected: true },
      { reported: undefined, fallback: false, expected: false },
      { reported: undefined, fallback: undefined, expected: false },
    ])('reports enabled=$expected when Cognito reports $reported and the fallback is $fallback', ({ reported, fallback, expected }) => {
      const user = mapper.fromFetchedUser({ Enabled: reported }, toUsername('alice'), fallback);

      expect(user.enabled).toBe(expected);
    });
  });
});
