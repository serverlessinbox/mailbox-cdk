/**
 * JMAP API scope definitions for Cognito resource server
 * https://jmap.io/
 */

export enum Permission {
  MAIL_READ = 'mail/read',
  MAIL_WRITE = 'mail/write',
  MAIL_SEND = 'mail/send',
  ACCOUNT_READ = 'account/read',
  ALIAS_READ = 'alias/read',
  ALIAS_WRITE = 'alias/write',
  USER_READ = 'user/read',

  ADMIN = 'admin',
}

/**
 * Human-readable descriptions for each JMAP scope
 */
export const JMAP_SCOPE_DESCRIPTIONS: Record<Permission, string> = {
  [Permission.MAIL_READ]: 'Read emails',
  [Permission.MAIL_WRITE]: 'Write emails',
  [Permission.MAIL_SEND]: 'Send emails',
  [Permission.ACCOUNT_READ]: 'Read account',
  [Permission.ALIAS_READ]: 'Read aliases',
  [Permission.ALIAS_WRITE]: 'Write aliases',
  [Permission.USER_READ]: 'Read user',
  [Permission.ADMIN]: 'Admin access',
};
