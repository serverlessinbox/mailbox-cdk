import type { AccountId, Issuer, TenantId } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { Audience }                    from '../auth-identifiers';

/** What the authorizer takes from a JWT whose signature and time claims verified. */
export interface VerifiedJwt {
  readonly sub:    string;
  readonly issuer: Issuer;
  /** The `client_id` claim, else the first `aud` value; empty when the token names neither. */
  readonly audience: Audience;
}

/**
 * The payload of an HMAC session token: the tenant it was issued for, the issuer, audience and subject that must
 * agree with the JWT, and the accounts the bearer may read blobs of.
 */
export interface HmacTokenPayload {
  readonly tenantId:   TenantId;
  readonly issuer:     Issuer;
  readonly audience:   Audience;
  readonly sub:        string;
  readonly accountIds: AccountId[];
}

/** Why a personal access token's lookup row does not authorize a download. */
export type PatUnusableReason = 'not-found' | 'revoked' | 'expired' | 'unparsable';

/**
 * A lookup row that authorizes a download: the tenant and token it names, and when it stops authorizing, as the
 * row's `expiresAt` in epoch milliseconds.
 */
export interface UsablePatVerdict {
  readonly usable:    true;
  readonly tenantId:  TenantId;
  readonly tokenId:   string;
  readonly expiresAt: number;
}

/** A lookup row, or the absence of one, that does not authorize a download. */
export interface UnusablePatVerdict {
  readonly usable: false;
  readonly reason: PatUnusableReason;
}

/** The verdict on one presented personal access token secret. */
export type PatVerdict = UsablePatVerdict | UnusablePatVerdict;
