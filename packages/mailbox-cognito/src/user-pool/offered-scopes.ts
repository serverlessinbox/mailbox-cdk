import { CognitoScope, DeprecatedCognitoScopes, RESOURCE_SERVER_IDENTIFIER,
  UnofferedCognitoScopes } from './cognito-scope';

/**
 * The OAuth scopes offered to third-party clients: the identity scopes, `offline_access`, and every Cognito resource
 * scope that is neither deprecated nor unoffered. Every reader of the offered scopes takes them from here.
 */
export class OfferedScopes {
  /** The OpenID Connect identity scopes. */
  public static readonly IDENTITY: readonly string[] = ['openid', 'email', 'profile'];

  /** The scope that asks for a refresh token; it is never passed to Cognito. */
  public static readonly OFFLINE_ACCESS = 'offline_access';

  /** Every offered resource scope, as `si/<name>`, in the order of `CognitoScope`. */
  public static resource(): string[] {
    return Object.values(CognitoScope)
      .filter((scope) => !DeprecatedCognitoScopes.has(scope) && !UnofferedCognitoScopes.has(scope))
      .map((scope) => `${RESOURCE_SERVER_IDENTIFIER}/${scope}`);
  }

  /** Every offered scope: the identity scopes, `offline_access`, then the resource scopes. */
  public static all(): string[] {
    return [...OfferedScopes.IDENTITY, OfferedScopes.OFFLINE_ACCESS, ...OfferedScopes.resource()];
  }
}
