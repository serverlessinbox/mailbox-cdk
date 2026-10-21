import { Permission } from '@serverlessinbox/mailbox';

/** The scope names of the Cognito resource server, one per mailbox permission. */
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

/** The mailbox permissions each Cognito scope grants. */
export const CognitoScopeToPermissions: Record<CognitoScope, Permission[]> = {
  [CognitoScope.MAIL_READ]: [Permission.MAIL_READ],
  [CognitoScope.MAIL_WRITE]: [Permission.MAIL_WRITE],
  [CognitoScope.MAIL_SEND]: [Permission.MAIL_SEND],
  [CognitoScope.ACCOUNT_READ]: [Permission.ACCOUNT_READ],
  [CognitoScope.ALIAS_READ]: [Permission.ALIAS_READ],
  [CognitoScope.ALIAS_WRITE]: [Permission.ALIAS_WRITE],
  [CognitoScope.USER_READ]: [Permission.USER_READ],
  [CognitoScope.CONTACTS_READ]: [Permission.CONTACTS_READ],
  [CognitoScope.CONTACTS_WRITE]: [Permission.CONTACTS_WRITE],
  [CognitoScope.ADMIN]: [Permission.ADMIN],
};

/** The Cognito scope that grants each mailbox permission; the inverse of `CognitoScopeToPermissions`. */
export const PermissionToCognitoScope: Record<Permission, CognitoScope> = {
  [Permission.MAIL_READ]: CognitoScope.MAIL_READ,
  [Permission.MAIL_WRITE]: CognitoScope.MAIL_WRITE,
  [Permission.MAIL_SEND]: CognitoScope.MAIL_SEND,
  [Permission.ACCOUNT_READ]: CognitoScope.ACCOUNT_READ,
  [Permission.ALIAS_READ]: CognitoScope.ALIAS_READ,
  [Permission.ALIAS_WRITE]: CognitoScope.ALIAS_WRITE,
  [Permission.USER_READ]: CognitoScope.USER_READ,
  [Permission.CONTACTS_READ]: CognitoScope.CONTACTS_READ,
  [Permission.CONTACTS_WRITE]: CognitoScope.CONTACTS_WRITE,
  [Permission.ADMIN]: CognitoScope.ADMIN,
};
