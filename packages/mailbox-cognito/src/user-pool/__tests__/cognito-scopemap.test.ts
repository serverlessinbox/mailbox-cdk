/**
 * Pins the Cognito resource server's scope list and the rights each scope grants. The scope names are the
 * deployed contract: a renamed scope is a new scope that existing clients do not request. The rights rows are the
 * Cognito mapping table of the authorization model plan.
 */

import { Permission }                                          from '@serverlessinbox/mailbox';

import { CognitoScopeDescriptions, CognitoScopeToPermissions } from '../cognito-scopemap';
import { CognitoScope, DeprecatedCognitoScopes }               from '../cognito-scope';

const RESOURCE_SERVER_SCOPE_NAMES = [
  'mail.read',
  'mail.write',
  'mail.send',
  'account.read',
  'alias.read',
  'alias.write',
  'user.read',
  'preferences.read',
  'preferences.write',
  'contacts.read',
  'contacts.write',
  'sieve.read',
  'sieve.write',
  'admin',
  'tokens.manage',
];

describe('Cognito resource server scopes', () => {
  it('keeps exactly the fifteen scope names, whatever permissions exist', () => {
    expect(Object.keys(CognitoScopeToPermissions)).toEqual(RESOURCE_SERVER_SCOPE_NAMES);
    expect(Object.values(CognitoScope)).toEqual(RESOURCE_SERVER_SCOPE_NAMES);
  });

  it('describes each scope as the resource server did before rights', () => {
    expect(CognitoScopeDescriptions).toEqual({
      [CognitoScope.MAIL_READ]:         'Read emails',
      [CognitoScope.MAIL_WRITE]:        'Write emails',
      [CognitoScope.MAIL_SEND]:         'Send emails',
      [CognitoScope.ACCOUNT_READ]:      'Read account',
      [CognitoScope.ALIAS_READ]:        'Read aliases',
      [CognitoScope.ALIAS_WRITE]:       'Write aliases',
      [CognitoScope.USER_READ]:         'Read user',
      [CognitoScope.PREFERENCES_READ]:  'Read your preferences and client settings',
      [CognitoScope.PREFERENCES_WRITE]: 'Change your preferences and client settings',
      [CognitoScope.CONTACTS_READ]:     'Read contacts',
      [CognitoScope.CONTACTS_WRITE]:    'Write contacts',
      [CognitoScope.SIEVE_READ]:        'Read your Sieve filter scripts',
      [CognitoScope.SIEVE_WRITE]:       'Write your Sieve filter scripts',
      [CognitoScope.ADMIN]:             'Admin access',
      [CognitoScope.TOKENS_MANAGE]:     'Manage your personal access tokens',
    });
  });

  it.each([
    [CognitoScope.MAIL_READ,     [Permission.MAIL_READ_ITEMS]],
    [CognitoScope.MAIL_WRITE,    [
      Permission.MAIL_ADD_ITEMS,
      Permission.MAIL_REMOVE_ITEMS,
      Permission.MAIL_SET_SEEN,
      Permission.MAIL_SET_KEYWORDS,
      Permission.MAIL_CREATE_CHILD,
      Permission.MAIL_RENAME,
      Permission.MAIL_DELETE,
      Permission.IMPORT_READ,
      Permission.IMPORT_WRITE,
    ]],
    [CognitoScope.MAIL_SEND,     [Permission.MAIL_SUBMIT]],
    [CognitoScope.ACCOUNT_READ,  []],
    [CognitoScope.ALIAS_READ,    []],
    [CognitoScope.ALIAS_WRITE,   []],
    [CognitoScope.USER_READ,     [Permission.PREFERENCES_READ]],
    [CognitoScope.PREFERENCES_READ, [Permission.PREFERENCES_READ]],
    [CognitoScope.PREFERENCES_WRITE, [Permission.PREFERENCES_WRITE]],
    [CognitoScope.CONTACTS_READ, [Permission.CONTACTS_READ]],
    [CognitoScope.CONTACTS_WRITE, [Permission.CONTACTS_WRITE, Permission.CONTACTS_DELETE]],
    [CognitoScope.SIEVE_READ,    [Permission.SIEVE_READ]],
    [CognitoScope.SIEVE_WRITE,   [Permission.SIEVE_WRITE]],
    [CognitoScope.ADMIN,         [Permission.ADMIN]],
    [CognitoScope.TOKENS_MANAGE, [Permission.TOKENS_MANAGE]],
  ])('grants the rights of %s as the mapping table states', (scope, rights) => {
    expect(CognitoScopeToPermissions[scope]).toEqual(rights);
  });

  it('marks only user.read as deprecated', () => {
    expect([...DeprecatedCognitoScopes]).toEqual([CognitoScope.USER_READ]);
  });

  it('lists each right under exactly one non-deprecated scope', () => {
    const rightsPerScope = Object.values(CognitoScope)
      .filter((scope) => !DeprecatedCognitoScopes.has(scope))
      .flatMap((scope) => CognitoScopeToPermissions[scope]);

    expect(new Set(rightsPerScope).size).toBe(rightsPerScope.length);
  });
});
