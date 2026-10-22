/**
 * The identity provider section of the admin UI configuration.
 */
export interface MailboxUserPoolIdpUiConfig {
  /**
   * The kind of identity provider that authenticates admin UI users. Always `cognito` for a
   * `MailboxUserPool`.
   */
  readonly type: string;
}

/**
 * The part of the admin UI's runtime configuration (`config/config.json`) that a `MailboxUserPool`
 * contributes: it tells the admin UI which identity provider its users sign in with.
 */
export interface MailboxUserPoolAdminUiConfig {
  /** The identity provider the admin UI's users sign in with. */
  readonly idp: MailboxUserPoolIdpUiConfig;
}
