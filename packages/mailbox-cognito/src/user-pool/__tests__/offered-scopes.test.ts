/// <reference types="jest" />

/**
 * Pins the OAuth scopes offered to third-party clients: every resource scope except the deprecated `user.read` and the
 * unoffered `admin` and `tokens.manage`, with the identity scopes and `offline_access` in front.
 */

import { ScopePolicy }   from '../../runtime/jmap-oauth-dcr/scope-policy';
import { OfferedScopes } from '../offered-scopes';

const EXPECTED_RESOURCE_SCOPES = [
  'si/mail.read',
  'si/mail.write',
  'si/mail.send',
  'si/account.read',
  'si/alias.read',
  'si/alias.write',
  'si/preferences.read',
  'si/preferences.write',
  'si/contacts.read',
  'si/contacts.write',
  'si/sieve.read',
  'si/sieve.write',
];

describe('OfferedScopes.resource', () => {
  it('offers every resource scope except the deprecated and unoffered ones, in the order of CognitoScope', () => {
    expect(OfferedScopes.resource()).toEqual(EXPECTED_RESOURCE_SCOPES);
  });

  it('offers the Sieve scopes', () => {
    expect(OfferedScopes.resource()).toEqual(expect.arrayContaining(['si/sieve.read', 'si/sieve.write']));
  });

  it('never offers the admin or tokens.manage scopes', () => {
    expect(OfferedScopes.resource()).not.toContain('si/admin');
    expect(OfferedScopes.resource()).not.toContain('si/tokens.manage');
  });

  it('does not offer the deprecated user.read scope', () => {
    expect(OfferedScopes.resource()).not.toContain('si/user.read');
  });
});

describe('OfferedScopes.all', () => {
  it('lists the identity scopes, then offline_access, then the resource scopes', () => {
    expect(OfferedScopes.all()).toEqual(['openid', 'email', 'profile', 'offline_access', ...EXPECTED_RESOURCE_SCOPES]);
  });

  it('includes offline_access', () => {
    expect(OfferedScopes.all()).toContain('offline_access');
  });

  it('offers every scope the default grant gives a client that asks for nothing', () => {
    expect(OfferedScopes.all()).toEqual(expect.arrayContaining(ScopePolicy.grantFor(undefined)));
  });
});
