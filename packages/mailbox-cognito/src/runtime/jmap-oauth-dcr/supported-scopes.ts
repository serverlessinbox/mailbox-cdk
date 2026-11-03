/** The OpenID Connect identity scopes. */
export const IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const;

/** The mail and contacts scopes of the `si/` resource server. */
export const MAIL_SCOPES = ['si/mail.read', 'si/mail.write', 'si/mail.send', 'si/contacts.read', 'si/contacts.write'] as const;

/** The OAuth scopes this authorization server supports: identity, `offline_access`, then mail. */
export const SUPPORTED_SCOPES = [...IDENTITY_SCOPES, 'offline_access', ...MAIL_SCOPES] as const;
