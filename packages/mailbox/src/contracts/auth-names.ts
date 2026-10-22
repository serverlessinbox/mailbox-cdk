/** Name of an auth policy: one per API whose requests are authorized. */
export type AuthPolicyName = typeof AUTH_POLICY_ADMIN_API | typeof AUTH_POLICY_JMAP_API;

/** Name of the OAuth client of one of the UIs. */
export type OAuthClientName =
  | typeof OAUTH_CLIENT_ADMIN_UI
  | typeof OAUTH_CLIENT_WEBMAIL_UI;

/** Name of the auth policy that protects the Admin API. */
export const AUTH_POLICY_ADMIN_API = 'ADMIN_API' as const;
/** Name of the auth policy that protects the JMAP API. */
export const AUTH_POLICY_JMAP_API  = 'JMAP_API' as const;

/** Name of the OAuth client of the Admin UI. */
export const OAUTH_CLIENT_ADMIN_UI   = 'ADMIN_UI' as const;
/** Name of the OAuth client of the Webmail UI. */
export const OAUTH_CLIENT_WEBMAIL_UI = 'WEBMAIL_UI' as const;
