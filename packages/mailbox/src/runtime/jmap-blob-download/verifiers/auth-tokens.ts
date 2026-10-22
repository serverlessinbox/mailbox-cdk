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
 * The payload of an HMAC session token: the tenant it was issued for, the issuer and audience that must agree
 * with the JWT, and the accounts the bearer may read blobs of.
 */
export interface HmacTokenPayload {
  readonly tenantId:   TenantId;
  readonly issuer:     Issuer;
  readonly audience:   Audience;
  readonly accountIds: AccountId[];
}
