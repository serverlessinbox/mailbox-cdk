/**
 * What a client may do against the JMAP API. The enum value of each permission is its OAuth scope
 * name.
 *
 * An auth provider maps the scopes it issues to these permissions (`scopeMap`), and a JMAP OAuth
 * client is provisioned with the permissions it needs, so give a client only the permissions it uses.
 */
export enum Permission {
  /** Read emails. */
  MAIL_READ = 'mail/read',
  /** Write emails. */
  MAIL_WRITE = 'mail/write',
  /** Send emails. */
  MAIL_SEND = 'mail/send',
  /** Read the account. */
  ACCOUNT_READ = 'account/read',
  /** Read aliases. */
  ALIAS_READ = 'alias/read',
  /** Write aliases. */
  ALIAS_WRITE = 'alias/write',
  /** Read the user. */
  USER_READ = 'user/read',
  /** Read contacts. */
  CONTACTS_READ = 'contacts/read',
  /** Write contacts. */
  CONTACTS_WRITE = 'contacts/write',

  /** Administrative access. */
  ADMIN = 'admin',
}

/**
 * What an auth provider's scopes stand for: each OAuth scope name the provider issues, mapped to the
 * {@link Permission}s it grants.
 */
export type ScopeMap = Record<string, Permission[]>;

/** A human-readable description for each {@link Permission}. */
export const JMAP_SCOPE_DESCRIPTIONS: Record<Permission, string> = {
  [Permission.MAIL_READ]:      'Read emails',
  [Permission.MAIL_WRITE]:     'Write emails',
  [Permission.MAIL_SEND]:      'Send emails',
  [Permission.ACCOUNT_READ]:   'Read account',
  [Permission.ALIAS_READ]:     'Read aliases',
  [Permission.ALIAS_WRITE]:    'Write aliases',
  [Permission.USER_READ]:      'Read user',
  [Permission.CONTACTS_READ]:  'Read contacts',
  [Permission.CONTACTS_WRITE]: 'Write contacts',
  [Permission.ADMIN]:          'Admin access',
};
