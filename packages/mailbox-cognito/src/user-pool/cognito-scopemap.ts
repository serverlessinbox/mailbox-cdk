import { Permission } from '@serverlessinbox/mailbox';

/** The scope names of the Cognito resource server. The set is fixed: no permission adds a scope. */
export enum CognitoScope {
  MAIL_READ = 'mail.read',
  MAIL_WRITE = 'mail.write',
  MAIL_SEND = 'mail.send',
  ACCOUNT_READ = 'account.read',
  ALIAS_READ = 'alias.read',
  ALIAS_WRITE = 'alias.write',
  USER_READ = 'user.read',
  CONTACTS_READ = 'contacts.read',
  CONTACTS_WRITE = 'contacts.write',
  ADMIN = 'admin',
}

/**
 * The rights each Cognito scope grants, in the order of `CognitoScope`. An IdP scope is mapped straight to
 * rights here; the mapping is the Cognito provider's, and the rights vocabulary is shared with every provider.
 */
export const CognitoScopeToPermissions: Record<CognitoScope, Permission[]> = {
  [CognitoScope.MAIL_READ]:      [Permission.MAIL_READ_ITEMS],
  [CognitoScope.MAIL_WRITE]:     [
    Permission.MAIL_ADD_ITEMS,
    Permission.MAIL_REMOVE_ITEMS,
    Permission.MAIL_SET_SEEN,
    Permission.MAIL_SET_KEYWORDS,
    Permission.MAIL_CREATE_CHILD,
    Permission.MAIL_RENAME,
    Permission.MAIL_DELETE,
    Permission.IMPORT_READ,
    Permission.IMPORT_WRITE,
  ],
  [CognitoScope.MAIL_SEND]:      [Permission.MAIL_SUBMIT],
  [CognitoScope.ACCOUNT_READ]:   [],
  [CognitoScope.ALIAS_READ]:     [],
  [CognitoScope.ALIAS_WRITE]:    [],
  [CognitoScope.USER_READ]:      [Permission.PREFERENCES_READ, Permission.PREFERENCES_WRITE],
  [CognitoScope.CONTACTS_READ]:  [Permission.CONTACTS_READ],
  [CognitoScope.CONTACTS_WRITE]: [Permission.CONTACTS_WRITE, Permission.CONTACTS_DELETE],
  [CognitoScope.ADMIN]:          [Permission.ADMIN],
};

/** The description each Cognito scope carries on the resource server. */
export const CognitoScopeDescriptions: Record<CognitoScope, string> = {
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
};
