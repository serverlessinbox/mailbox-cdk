import { Permission } from '@sipkg/mailbox';

export enum CognitoScope {
  MAIL_READ = 'mail.read',
  MAIL_WRITE = 'mail.write',
  MAIL_SEND = 'mail.send',
  ACCOUNT_READ = 'account.read',
  ALIAS_READ = 'alias.read',
  ALIAS_WRITE = 'alias.write',
  USER_READ = 'user.read',
  ADMIN = 'admin',
}

export const CognitoScopeToPermissions: Record<CognitoScope, Permission[]> = {
  [CognitoScope.MAIL_READ]: [Permission.MAIL_READ],
  [CognitoScope.MAIL_WRITE]: [Permission.MAIL_WRITE],
  [CognitoScope.MAIL_SEND]: [Permission.MAIL_SEND],
  [CognitoScope.ACCOUNT_READ]: [Permission.ACCOUNT_READ],
  [CognitoScope.ALIAS_READ]: [Permission.ALIAS_READ],
  [CognitoScope.ALIAS_WRITE]: [Permission.ALIAS_WRITE],
  [CognitoScope.USER_READ]: [Permission.USER_READ],
  [CognitoScope.ADMIN]: [Permission.ADMIN],
};

export const PermissionToCognitoScope: Record<Permission, CognitoScope> = {
  [Permission.MAIL_READ]: CognitoScope.MAIL_READ,
  [Permission.MAIL_WRITE]: CognitoScope.MAIL_WRITE,
  [Permission.MAIL_SEND]: CognitoScope.MAIL_SEND,
  [Permission.ACCOUNT_READ]: CognitoScope.ACCOUNT_READ,
  [Permission.ALIAS_READ]: CognitoScope.ALIAS_READ,
  [Permission.ALIAS_WRITE]: CognitoScope.ALIAS_WRITE,
  [Permission.USER_READ]: CognitoScope.USER_READ,
  [Permission.ADMIN]: CognitoScope.ADMIN,
};
