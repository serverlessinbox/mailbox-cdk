import { toScope, type Scope }                            from '../shared/identity-identifiers';

import { IDENTITY_SCOPES, MAIL_SCOPES, SUPPORTED_SCOPES } from './supported-scopes';

const OFFLINE_ACCESS_SCOPE = 'offline_access';

/**
 * The scopes a new client registration is granted, decided from the scope it asked for. It never rejects a
 * request: a token outside `SUPPORTED_SCOPES` is dropped, and a request that names no mail scope is granted all of them.
 */
export class ScopePolicy {
  /** The granted scopes, in constant order and without duplicates. */
  public static grantFor(requested: string | undefined): Scope[] {
    const asked: readonly string[] = ScopePolicy.askedTokens(requested);
    const identityAsked            = IDENTITY_SCOPES.filter((scope) => asked.includes(scope));
    const mailAsked                = MAIL_SCOPES.filter((scope) => asked.includes(scope));

    if (mailAsked.length === 0) {
      const identity = identityAsked.length > 0 ? identityAsked : IDENTITY_SCOPES;
      return [...identity, ...MAIL_SCOPES].map(toScope);
    }
    return [...identityAsked, ...mailAsked].map(toScope);
  }

  /** The number of requested tokens outside `SUPPORTED_SCOPES`. `offline_access` is not counted. */
  public static droppedCount(requested: string | undefined): number {
    return ScopePolicy.askedTokens(requested).filter((token) => !ScopePolicy.isSupported(token)).length;
  }

  private static askedTokens(requested: string | undefined): string[] {
    return (requested ?? '').split(' ').filter((token) => token.length > 0 && token !== OFFLINE_ACCESS_SCOPE);
  }

  private static isSupported(token: string): boolean {
    const supported: readonly string[] = SUPPORTED_SCOPES;
    return supported.includes(token);
  }
}
