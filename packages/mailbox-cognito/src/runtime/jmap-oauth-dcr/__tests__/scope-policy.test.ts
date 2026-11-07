/// <reference types="jest" />

/**
 * Pins which scopes a new registration is granted for what it asked, and that no offered scope reaches an
 * administrator or personal access token right.
 */

import { Permission }                from '@serverlessinbox/mailbox';

import { CognitoScopeToPermissions } from '../../../user-pool/cognito-scopemap';
import { CognitoScope }              from '../../../user-pool/cognito-scope';
import { OfferedScopes }             from '../../../user-pool/offered-scopes';
import { ScopePolicy }               from '../scope-policy';

describe('ScopePolicy.grantFor', () => {
  it.each([
    { asks: 'nothing (undefined)', requested: undefined,                              granted: ['openid', 'email', 'profile', 'si/mail.read', 'si/mail.write', 'si/mail.send', 'si/contacts.read', 'si/contacts.write'] },
    { asks: 'an empty string',     requested: '',                                     granted: ['openid', 'email', 'profile', 'si/mail.read', 'si/mail.write', 'si/mail.send', 'si/contacts.read', 'si/contacts.write'] },
    { asks: 'offline_access only', requested: 'offline_access',                       granted: ['openid', 'email', 'profile', 'si/mail.read', 'si/mail.write', 'si/mail.send', 'si/contacts.read', 'si/contacts.write'] },
    { asks: 'identity scopes only', requested: 'openid email profile',                granted: ['openid', 'email', 'profile', 'si/mail.read', 'si/mail.write', 'si/mail.send', 'si/contacts.read', 'si/contacts.write'] },
    { asks: 'one mail scope',      requested: 'si/mail.read',                         granted: ['si/mail.read'] },
    { asks: 'one sieve scope',     requested: 'si/sieve.read',                        granted: ['si/sieve.read'] },
    { asks: 'identity and a mail scope with an admin scope', requested: 'openid si/mail.read si/admin', granted: ['openid', 'si/mail.read'] },
    { asks: 'an admin scope only', requested: 'si/admin',                             granted: ['openid', 'email', 'profile', 'si/mail.read', 'si/mail.write', 'si/mail.send', 'si/contacts.read', 'si/contacts.write'] },
    { asks: 'a tokens.manage scope only', requested: 'si/tokens.manage',              granted: ['openid', 'email', 'profile', 'si/mail.read', 'si/mail.write', 'si/mail.send', 'si/contacts.read', 'si/contacts.write'] },
    { asks: 'identity, tokens.manage, admin and a mail scope', requested: 'openid si/tokens.manage si/admin si/mail.read', granted: ['openid', 'si/mail.read'] },
    { asks: 'only tokens outside the allowlist', requested: 'aws.cognito.signin.user.admin phone', granted: ['openid', 'email', 'profile', 'si/mail.read', 'si/mail.write', 'si/mail.send', 'si/contacts.read', 'si/contacts.write'] },
    { asks: 'duplicates',          requested: 'si/mail.read openid si/mail.read openid', granted: ['openid', 'si/mail.read'] },
  ])('grants the scopes in constant order when the request asks for $asks', ({ requested, granted }) => {
    expect(ScopePolicy.grantFor(requested)).toEqual(granted);
  });
});

describe('ScopePolicy.droppedCount', () => {
  it('counts the tokens outside the allowlist and does not count offline_access', () => {
    expect(ScopePolicy.droppedCount('offline_access si/admin phone')).toBe(2);
    expect(ScopePolicy.droppedCount('openid si/mail.read si/admin phone')).toBe(2);
  });
});

describe('the offered scopes against the Cognito resource server', () => {
  const offered: readonly string[]      = OfferedScopes.all();
  const cognitoNames: readonly string[] = Object.values(CognitoScope);

  it('names a Cognito scope for every si/ entry', () => {
    const resourceNames = offered
      .filter((scope) => scope.startsWith('si/'))
      .map((scope) => scope.slice('si/'.length));

    expect(resourceNames.filter((name) => !cognitoNames.includes(name))).toEqual([]);
  });

  it('grants no admin or personal access token right through any offered scope', () => {
    const grantable                     = Object.values(CognitoScope).filter((scope) => OfferedScopes.resource().includes(`si/${scope}`));
    const rights: readonly Permission[] = grantable.flatMap((scope) => CognitoScopeToPermissions[scope]);

    expect(rights).not.toContain(Permission.ADMIN);
    expect(rights).not.toContain(Permission.TOKENS_MANAGE);
  });
});
