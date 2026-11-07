import { Permission }   from '@serverlessinbox/mailbox';

import { CognitoScope } from './cognito-scope';

/**
 * The rights each Cognito scope grants, in the order of `CognitoScope`. An IdP scope is mapped straight to
 * rights here; the mapping is the Cognito provider's, and the rights vocabulary is shared with every provider.
 */
export const CognitoScopeToPermissions: Record<CognitoScope, Permission[]> = {
  [CognitoScope.MAIL_READ]:         [Permission.MAIL_READ_ITEMS],
  [CognitoScope.MAIL_WRITE]:        [
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
  [CognitoScope.MAIL_SEND]:         [Permission.MAIL_SUBMIT],
  [CognitoScope.ACCOUNT_READ]:      [],
  [CognitoScope.ALIAS_READ]:        [],
  [CognitoScope.ALIAS_WRITE]:       [],
  [CognitoScope.USER_READ]:         [Permission.PREFERENCES_READ],
  [CognitoScope.PREFERENCES_READ]:  [Permission.PREFERENCES_READ],
  [CognitoScope.PREFERENCES_WRITE]: [Permission.PREFERENCES_WRITE],
  [CognitoScope.CONTACTS_READ]:     [Permission.CONTACTS_READ],
  [CognitoScope.CONTACTS_WRITE]:    [Permission.CONTACTS_WRITE, Permission.CONTACTS_DELETE],
  [CognitoScope.SIEVE_READ]:        [Permission.SIEVE_READ],
  [CognitoScope.SIEVE_WRITE]:       [Permission.SIEVE_WRITE],
  [CognitoScope.ADMIN]:             [Permission.ADMIN],
  [CognitoScope.TOKENS_MANAGE]:     [Permission.TOKENS_MANAGE],
};

/** The description each Cognito scope carries on the resource server. */
export const CognitoScopeDescriptions: Record<CognitoScope, string> = {
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
};
