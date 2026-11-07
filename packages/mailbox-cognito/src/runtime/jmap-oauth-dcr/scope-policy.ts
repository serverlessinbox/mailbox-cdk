import { CognitoScope, RESOURCE_SERVER_IDENTIFIER } from '../../user-pool/cognito-scope';
import { OfferedScopes }                            from '../../user-pool/offered-scopes';
import { toScope, type Scope }                      from '../shared/identity-identifiers';

/**
 * The scopes a new client registration is granted, decided from the scope it asked for. It never rejects a
 * request: a token outside `OfferedScopes.all()` is dropped, and a request that names no resource scope is granted
 * the default resource grant.
 */
export class ScopePolicy {
  /** The resource scopes granted to a request that names none. A scope outside this grant is granted only when asked for. */
  private static readonly DEFAULT_RESOURCE_GRANT: readonly string[] = [
    CognitoScope.MAIL_READ,
    CognitoScope.MAIL_WRITE,
    CognitoScope.MAIL_SEND,
    CognitoScope.CONTACTS_READ,
    CognitoScope.CONTACTS_WRITE,
  ].map((scope) => `${RESOURCE_SERVER_IDENTIFIER}/${scope}`);

  /** The granted scopes, in constant order and without duplicates. */
  public static grantFor(requested: string | undefined): Scope[] {
    const asked: readonly string[] = ScopePolicy.askedTokens(requested);
    const identityAsked            = OfferedScopes.IDENTITY.filter((scope) => asked.includes(scope));
    const resourceAsked            = OfferedScopes.resource().filter((scope) => asked.includes(scope));

    if (resourceAsked.length === 0) {
      const identity = identityAsked.length > 0 ? identityAsked : OfferedScopes.IDENTITY;
      return [...identity, ...ScopePolicy.DEFAULT_RESOURCE_GRANT].map(toScope);
    }
    return [...identityAsked, ...resourceAsked].map(toScope);
  }

  /** The number of requested tokens outside `OfferedScopes.all()`. `offline_access` is not counted. */
  public static droppedCount(requested: string | undefined): number {
    return ScopePolicy.askedTokens(requested).filter((token) => !ScopePolicy.isOffered(token)).length;
  }

  private static askedTokens(requested: string | undefined): string[] {
    return (requested ?? '').split(' ').filter((token) => token.length > 0 && token !== OfferedScopes.OFFLINE_ACCESS);
  }

  private static isOffered(token: string): boolean {
    const offered: readonly string[] = OfferedScopes.all();
    return offered.includes(token);
  }
}
