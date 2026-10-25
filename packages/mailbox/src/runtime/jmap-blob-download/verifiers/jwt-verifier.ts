import { DynamoDBClient, GetItemCommand }                                                          from '@aws-sdk/client-dynamodb';
import { toIssuer, type Issuer, type TableName }                                                   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { createLocalJWKSet, decodeJwt, decodeProtectedHeader, errors, jwtVerify, type JWTPayload } from 'jose';
import * as t                                                                                      from 'typanion';

import { toAudience, type Audience }                                                               from '../auth-identifiers';
import type { SupportedAlgorithm }                                                                 from '../cloudfront/origin-headers';

import type { VerifiedJwt }                                                                        from './auth-tokens';

const isKeySetDocument = t.isPartial({ keys: t.isArray(t.isUnknown()) });
const isJwkMember      = t.isPartial({ kty: t.isString() });

type JwkMember = t.InferType<typeof isJwkMember>;

/** The keys of one issuer, ready to select a key by the `kid` of a token. */
type KeySet = ReturnType<typeof createLocalJWKSet>;

const DEFAULT_ALLOWED_ALGORITHMS: readonly SupportedAlgorithm[] = ['RS256'];
const CLOCK_TOLERANCE_SECONDS                                   = 300;

/**
 * Verifies JWTs against the issuers' public keys held in the auth key store. It checks the signature and the
 * time claims only; which tenant or account the token speaks for comes from the HMAC session token, so no
 * identity provider or account lookup happens here. The key set built from the JWKS of an issuer is cached for
 * the lifetime of the instance, which spans the warm invocations of one Lambda container; a token naming a key
 * the cached set lacks makes the verifier re-read the key set once, so a rotated signing key is picked up.
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
   * an `exp` (required) and `nbf` plus a clock tolerance, with a `sub`. A token that fails any of these, an unknown issuer or
   * key, or a key set that is missing or malformed has no identity. A failure to read the auth key store is not
   * a verification result and propagates to the caller.
   */
  public async verifySignatureOnly(
    token: string,
    authKeyStoreTable: TableName,
    allowedAlgorithms: readonly SupportedAlgorithm[] | undefined,
  ): Promise<VerifiedJwt | null> {
    const issuer = this.unverifiedIssuerOf(token, allowedAlgorithms);
    if (issuer === null) {
      return null;
    }

    const cached = this.keySetsByIssuer.get(issuer);
    const keySet = cached ?? await this.loadKeySet(issuer, authKeyStoreTable);
    if (keySet === null) {
      return null;
    }

    try {
      return await this.verifyWith(token, keySet, issuer, allowedAlgorithms);
    } catch (error) {
      if (cached === undefined || !(error instanceof errors.JWKSNoMatchingKey)) {
        return null;
      }
    }

    const refreshed = await this.loadKeySet(issuer, authKeyStoreTable);
    if (refreshed === null) {
      return null;
    }

    try {
      return await this.verifyWith(token, refreshed, issuer, allowedAlgorithms);
    } catch {
      return null;
    }
  }

  /** The identity of a token verified against the key set; throws when the signature or a claim fails, or no key of the set matches. */
  private async verifyWith(
    token: string,
    keySet: KeySet,
    issuer: Issuer,
    allowedAlgorithms: readonly SupportedAlgorithm[] | undefined,
  ): Promise<VerifiedJwt | null> {
    const { payload } = await jwtVerify(token, keySet, {
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      algorithms:     [...this.algorithmsOf(allowedAlgorithms)],
      requiredClaims: ['exp'],
    });

    return this.verifiedJwtOf(payload, issuer);
  }

  /** The normalized issuer of a token that decodes, names a `kid` and an allowed `alg`; otherwise null. */
  private unverifiedIssuerOf(token: string, allowedAlgorithms: readonly SupportedAlgorithm[] | undefined): Issuer | null {
    try {
      const { iss }    = decodeJwt(token);
      const header     = decodeProtectedHeader(token);
      const algorithms = this.algorithmsOf(allowedAlgorithms);
      if (typeof iss !== 'string') {
        return null;
      }
      const issuer = this.normalizeIssuer(iss);
      if (!issuer || !header.kid || !header.alg || !algorithms.some((algorithm) => algorithm === header.alg)) {
        return null;
      }
      return issuer;
    } catch {
      return null;
    }
  }

  private algorithmsOf(allowedAlgorithms: readonly SupportedAlgorithm[] | undefined): readonly SupportedAlgorithm[] {
    return allowedAlgorithms && allowedAlgorithms.length > 0 ? allowedAlgorithms : DEFAULT_ALLOWED_ALGORITHMS;
  }

  private normalizeIssuer(issuer: string): Issuer {
    return toIssuer(issuer.trim().replace(/\/+$/, ''));
  }

  /** Reads the key set of the issuer from the store and caches it, replacing an earlier one; null, with the cache untouched, when the store holds none or a malformed one. */
  private async loadKeySet(issuer: Issuer, authKeyStoreTable: TableName): Promise<KeySet | null> {
    const jwksJson = await this.loadJwksJson(issuer, authKeyStoreTable);
    if (jwksJson === null) {
      return null;
    }

    const keySet = this.keySetFrom(jwksJson);
    if (keySet !== null) {
      this.keySetsByIssuer.set(issuer, keySet);
    }
    return keySet;
  }

  /** The JWKS text the store holds for the issuer; null when it holds none. A failed read propagates. */
  private async loadJwksJson(issuer: Issuer, authKeyStoreTable: TableName): Promise<string | null> {
    const response = await this.dynamodb.send(
      new GetItemCommand({
        TableName: authKeyStoreTable,
        Key:       {
          'pk': { S: 'jwks' },
          'sk': { S: issuer },
        },
      }),
    );

    return response.Item?.jwks?.S || null;
  }

  /** The key set of a JWKS document; null when the text is not JSON or the document is not a key set. */
  private keySetFrom(jwksJson: string): KeySet | null {
    try {
      const document: unknown = JSON.parse(jwksJson);
      if (!isKeySetDocument(document)) {
        return null;
      }
      return createLocalJWKSet({ keys: document.keys.filter((member): member is JwkMember => isJwkMember(member)) });
    } catch {
      return null;
    }
  }

  /** The identity of a verified payload; null when its subject or client id is not a string, or its aud is neither a string nor a list of strings. */
  private verifiedJwtOf(payload: JWTPayload, issuer: Issuer): VerifiedJwt | null {
    const { sub, aud, client_id: clientId } = payload;
    if (typeof sub !== 'string' || !sub) {
      return null;
    }
    if (clientId !== undefined && typeof clientId !== 'string') {
      return null;
    }
    if (aud !== undefined && typeof aud !== 'string' && !(Array.isArray(aud) && aud.every((value) => typeof value === 'string'))) {
      return null;
    }

    return { sub, issuer, audience: this.audienceOf(payload) };
  }

  private audienceOf(payload: JWTPayload): Audience {
    const clientId = typeof payload.client_id === 'string' ? payload.client_id.trim() : '';
    if (clientId) {
      return toAudience(clientId);
    }

    const audience = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    return toAudience(audience || '');
  }
}
