/** Name of an auth policy: one per API whose requests are authorized. */
export enum AuthPolicyName {
  /** The auth policy that protects the Admin API. */
  ADMIN_API = 'ADMIN_API',

  /** The auth policy that protects the JMAP API. */
  JMAP_API = 'JMAP_API',
}

/** Name of the OAuth client of one of the UIs. */
export enum OAuthClientName {
  /** The OAuth client of the Admin UI. */
  ADMIN_UI = 'ADMIN_UI',

  /** The OAuth client of the Webmail UI. */
  WEBMAIL_UI = 'WEBMAIL_UI',
}
