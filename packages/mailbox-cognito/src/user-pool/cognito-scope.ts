/** The identifier of the resource server that carries the JMAP scopes. */
export const RESOURCE_SERVER_IDENTIFIER = 'si';

/**
 * The scope names of the Cognito resource server. A scope exists only as a member here, with its entries in
 * `CognitoScopeToPermissions` and `CognitoScopeDescriptions`; a permission never adds a scope.
 */
export enum CognitoScope {
  MAIL_READ = 'mail.read',
  MAIL_WRITE = 'mail.write',
  MAIL_SEND = 'mail.send',
  ACCOUNT_READ = 'account.read',
  ALIAS_READ = 'alias.read',
  ALIAS_WRITE = 'alias.write',
  USER_READ = 'user.read',
  PREFERENCES_READ = 'preferences.read',
  PREFERENCES_WRITE = 'preferences.write',
  CONTACTS_READ = 'contacts.read',
  CONTACTS_WRITE = 'contacts.write',
  SIEVE_READ = 'sieve.read',
  SIEVE_WRITE = 'sieve.write',
  ADMIN = 'admin',
  TOKENS_MANAGE = 'tokens.manage',
  PUSH_MANAGE = 'push.manage',
}

/**
 * Scopes that stay defined on the resource server so tokens and clients that still request them keep working,
 * and are removed in a later release. A right resolves only to a scope outside this set.
 */
export const DeprecatedCognitoScopes: ReadonlySet<CognitoScope> = new Set([CognitoScope.USER_READ]);

/**
 * Scopes that are defined on the resource server but never offered to a third-party OAuth client. Personal access
 * tokens are issued and managed by the user in person, so a delegated client must not mint or revoke them
 * (`tokens.manage`); a delegated client must never receive administrator rights (`admin`).
 */
export const UnofferedCognitoScopes: ReadonlySet<CognitoScope> = new Set([CognitoScope.TOKENS_MANAGE, CognitoScope.ADMIN]);
