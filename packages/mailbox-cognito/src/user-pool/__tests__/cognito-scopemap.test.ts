/**
 * Pins the Cognito resource server's scope list and the rights each scope grants. The scope names are the
 * deployed contract: a renamed scope is a new scope that existing clients do not request. The rights rows are the
 * Cognito mapping table of the authorization model plan.
 */

import { Permission }        from '@serverlessinbox/mailbox';

import {
  CognitoScope,
  CognitoScopeDescriptions,
  CognitoScopeToPermissions,
}                            from '../cognito-scopemap';

const RESOURCE_SERVER_SCOPE_NAMES = [
  'mail.read',
  'mail.write',
  'mail.send',
  'account.read',
  'alias.read',
  'alias.write',
  'user.read',
  'contacts.read',
  'contacts.write',
  'admin',
];

describe('Cognito resource server scopes', () => {
  it('keeps exactly the ten scope names, whatever permissions exist', () => {
    expect(Object.keys(CognitoScopeToPermissions)).toEqual(RESOURCE_SERVER_SCOPE_NAMES);
    expect(Object.values(CognitoScope)).toEqual(RESOURCE_SERVER_SCOPE_NAMES);
  });

  it('describes each scope as the resource server did before rights', () => {
    expect(CognitoScopeDescriptions).toEqual({
      [CognitoScope.MAIL_READ]:      'Read emails',
      [CognitoScope.MAIL_WRITE]:     'Write emails',
      [CognitoScope.MAIL_SEND]:      'Send emails',
      [CognitoScope.ACCOUNT_READ]:   'Read account',
      [CognitoScope.ALIAS_READ]:     'Read aliases',
      [CognitoScope.ALIAS_WRITE]:    'Write aliases',
      [CognitoScope.USER_READ]:      'Read user',
      [CognitoScope.CONTACTS_READ]:  'Read contacts',
      [CognitoScope.CONTACTS_WRITE]: 'Write contacts',
      [CognitoScope.ADMIN]:          'Admin access',
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
    ]],
    [CognitoScope.MAIL_SEND,     [Permission.MAIL_SUBMIT]],
    [CognitoScope.ACCOUNT_READ,  []],
    [CognitoScope.ALIAS_READ,    []],
    [CognitoScope.ALIAS_WRITE,   []],
    [CognitoScope.USER_READ,     [Permission.USER_READ, Permission.USER_WRITE]],
    [CognitoScope.CONTACTS_READ, [Permission.CONTACTS_READ]],
    [CognitoScope.CONTACTS_WRITE, [Permission.CONTACTS_WRITE, Permission.CONTACTS_DELETE]],
    [CognitoScope.ADMIN,         [Permission.ADMIN]],
  ])('grants the rights of %s as the mapping table states', (scope, rights) => {
    expect(CognitoScopeToPermissions[scope]).toEqual(rights);
  });

  it('lists each right under exactly one scope', () => {
    const rightsPerScope = Object.values(CognitoScopeToPermissions).flat();

    expect(new Set(rightsPerScope).size).toBe(rightsPerScope.length);
  });
});
