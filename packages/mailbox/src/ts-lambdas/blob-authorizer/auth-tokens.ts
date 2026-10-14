/** What the authorizer takes from a JWT whose signature and time claims verified. */
export interface VerifiedJwt {
  readonly sub: string;
  readonly issuer: string;
  /** The `client_id` claim, else the first `aud` value; empty when the token names neither. */
  readonly audience: string;
}

/**
 * The payload of an HMAC session token: the tenant it was issued for, the issuer and audience that must agree
 * with the JWT, and the accounts the bearer may read blobs of.
 */
export interface HmacTokenPayload {
  readonly tenantId: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accountIds: string[];
}
