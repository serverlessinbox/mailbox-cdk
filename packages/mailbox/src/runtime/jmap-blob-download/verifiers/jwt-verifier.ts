import { DynamoDBClient, GetItemCommand }                                 from '@aws-sdk/client-dynamodb';
import { toIssuer, type Issuer, type TableName }                          from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import * as t                                                             from 'typanion';

import { toAudience, type Audience }                                      from '../auth-identifiers';
import type { SupportedAlgorithm }                                        from '../cloudfront/origin-headers';

import type { VerifiedJwt }                                               from './auth-tokens';

const isJwtPayload = t.isPartial({
  sub:       t.isOptional(t.isString()),
  iss:       t.isOptional(t.isString()),
  aud:       t.isOptional(t.isOneOf([t.isString(), t.isArray(t.isString())])),
  client_id: t.isOptional(t.isString()),
  exp:       t.isOptional(t.isNumber()),
  nbf:       t.isOptional(t.isNumber()),
});

// A JWKS is the issuer's published document (RFC 7517); a key lists every field jose may read when matching it.
const isJwk = t.isPartial({
  kid: t.isOptional(t.isString()),
  kty: t.isString(),
  use: t.isOptional(t.isString()),
  alg: t.isOptional(t.isString()),
  n:   t.isOptional(t.isString()),
  e:   t.isOptional(t.isString()),
  crv: t.isOptional(t.isString()),
  x:   t.isOptional(t.isString()),
  y:   t.isOptional(t.isString()),
});

const isJwks = t.isPartial({
  keys: t.isArray(isJwk),
});

/** The claims of a JWT payload that the verifier reads. */
type JwtPayload = t.InferType<typeof isJwtPayload>;

/** The JSON Web Key Set an issuer publishes. */
type Jwks = t.InferType<typeof isJwks>;

/** The keys of one issuer, ready to select a key by the `kid` of a token. */
type KeySet = ReturnType<typeof createLocalJWKSet>;

const DEFAULT_ALLOWED_ALGORITHMS: readonly SupportedAlgorithm[] = ['RS256'];
const CLOCK_TOLERANCE_SECONDS                                   = 300;

/**
 * Verifies JWTs against the issuers' public keys held in the auth key store. It checks the signature and the
 * time claims only; which tenant or account the token speaks for comes from the HMAC session token, so no
 * identity provider or account lookup happens here. The key set built from the JWKS of an issuer is cached for
 * the lifetime of the instance, which spans the warm invocations of one Lambda container.
 */
export class JwtVerifier {
  private readonly dynamodb: DynamoDBClient;
  private readonly keySetsByIssuer = new Map<Issuer, KeySet>();

  constructor(dynamodb: DynamoDBClient) {
    this.dynamodb = dynamodb;
  }

  /**
   * The identity of a token whose signature verifies against the key its issuer published under the token's
   * `kid`, signed with an algorithm in `allowedAlgorithms` (RS256 when the list is absent or empty), within
   * `exp` and `nbf` plus a clock tolerance, with a `sub`. A token that fails any of these, or whose
   * verification fails for any other reason, such as an unknown issuer or key, has no identity.
   */
  public async verifySignatureOnly(
    token: string,
    authKeyStoreTable: TableName,
    allowedAlgorithms: readonly SupportedAlgorithm[] | undefined,
  ): Promise<VerifiedJwt | null> {
    try {
      const unverifiedClaims = this.claimsOf(decodeJwt(token));
      const issuer           = this.normalizeIssuer(unverifiedClaims?.iss ?? '');
      const header           = decodeProtectedHeader(token);
      const algorithms       = this.algorithmsOf(allowedAlgorithms);
      if (!issuer || !header.kid || !header.alg || !algorithms.some((algorithm) => algorithm === header.alg)) {
        return null;
      }

      const keySet      = await this.keySetOf(issuer, authKeyStoreTable);
      const { payload } = await jwtVerify(token, keySet, {
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        algorithms:     [...algorithms],
      });

      const claims = this.claimsOf(payload);
      if (!claims?.sub) {
        return null;
      }

      return { sub: claims.sub, issuer, audience: this.audienceOf(claims) };
    } catch {
      return null;
    }
  }

  private claimsOf(payload: unknown): JwtPayload | null {
    return isJwtPayload(payload) ? payload : null;
  }

  private algorithmsOf(allowedAlgorithms: readonly SupportedAlgorithm[] | undefined): readonly SupportedAlgorithm[] {
    return allowedAlgorithms && allowedAlgorithms.length > 0 ? allowedAlgorithms : DEFAULT_ALLOWED_ALGORITHMS;
  }

  private normalizeIssuer(issuer: string): Issuer {
    return toIssuer(issuer.trim().replace(/\/+$/, ''));
  }

  private async keySetOf(issuer: Issuer, authKeyStoreTable: TableName): Promise<KeySet> {
    const cached = this.keySetsByIssuer.get(issuer);
    if (cached) {
      return cached;
    }

    const keySet = createLocalJWKSet(await this.loadJwks(issuer, authKeyStoreTable));
    this.keySetsByIssuer.set(issuer, keySet);
    return keySet;
  }

  private async loadJwks(issuer: Issuer, authKeyStoreTable: TableName): Promise<Jwks> {
    const response = await this.dynamodb.send(
      new GetItemCommand({
        TableName: authKeyStoreTable,
        Key:       {
          pk: { S: 'jwks' },
          sk: { S: issuer },
        },
      }),
    );

    const jwksJson = response.Item?.jwks?.S;
    if (!jwksJson) {
      throw new Error(`JWKS not found in ${authKeyStoreTable} for issuer ${issuer}`);
    }

    const jwks: unknown    = JSON.parse(jwksJson);
    const errors: string[] = [];
    if (!isJwks(jwks, { errors })) {
      throw new Error(`JWKS of issuer ${issuer} in ${authKeyStoreTable} is malformed: ${errors.join('; ')}`);
    }
    return jwks;
  }

  private audienceOf(claims: JwtPayload): Audience {
    const clientId = claims.client_id?.trim();
    if (clientId) {
      return toAudience(clientId);
    }

    const audience = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
    return toAudience(audience || '');
  }
}
