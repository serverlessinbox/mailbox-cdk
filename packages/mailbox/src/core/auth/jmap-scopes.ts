/**
 * What a client may do against the JMAP API. Each permission's enum value is a JMAP right
 * (`mail/readItems`).
 *
 * An auth provider maps the scopes it issues to these permissions (`scopeMap`), and a JMAP OAuth
 * client is provisioned with the permissions it needs, so give a client only the permissions it uses.
 */
export enum Permission {
  /** Read the items of a mailbox. */
  MAIL_READ_ITEMS = 'mail/readItems',
  /** Add items to a mailbox. */
  MAIL_ADD_ITEMS = 'mail/addItems',
  /** Remove items from a mailbox. */
  MAIL_REMOVE_ITEMS = 'mail/removeItems',
  /** Set the seen flag on items. */
  MAIL_SET_SEEN = 'mail/setSeen',
  /** Set keywords on items. */
  MAIL_SET_KEYWORDS = 'mail/setKeywords',
  /** Create child mailboxes. */
  MAIL_CREATE_CHILD = 'mail/createChild',
  /** Rename mailboxes. */
  MAIL_RENAME = 'mail/rename',
  /** Delete mailboxes. */
  MAIL_DELETE = 'mail/delete',
  /** Submit emails for sending. */
  MAIL_SUBMIT = 'mail/submit',

  /** Read contacts. */
  CONTACTS_READ = 'contacts/read',
  /** Write contacts (JMAP `mayWrite`). */
  CONTACTS_WRITE = 'contacts/write',
  /** Delete contacts. */
  CONTACTS_DELETE = 'contacts/delete',

  /** Read your own preferences and client settings. */
  PREFERENCES_READ = 'preferences/read',
  /** Change your own preferences and client settings. */
  PREFERENCES_WRITE = 'preferences/write',

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
  [Permission.MAIL_READ_ITEMS]:   'Read mailbox items',
  [Permission.MAIL_ADD_ITEMS]:    'Add mailbox items',
  [Permission.MAIL_REMOVE_ITEMS]: 'Remove mailbox items',
  [Permission.MAIL_SET_SEEN]:     'Set seen flag',
  [Permission.MAIL_SET_KEYWORDS]: 'Set keywords',
  [Permission.MAIL_CREATE_CHILD]: 'Create mailboxes',
  [Permission.MAIL_RENAME]:       'Rename mailboxes',
  [Permission.MAIL_DELETE]:       'Delete mailboxes',
  [Permission.MAIL_SUBMIT]:       'Send emails',
  [Permission.CONTACTS_READ]:     'Read contacts',
  [Permission.CONTACTS_WRITE]:    'Write contacts',
  [Permission.CONTACTS_DELETE]:   'Delete contacts',
  [Permission.PREFERENCES_READ]:  'Read your own preferences and client settings',
  [Permission.PREFERENCES_WRITE]: 'Change your own preferences and client settings',
  [Permission.ADMIN]:             'Admin access',
};
