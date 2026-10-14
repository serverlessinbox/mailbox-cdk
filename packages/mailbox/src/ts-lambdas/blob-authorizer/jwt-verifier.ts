import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { webcrypto } from 'crypto';
import * as t from 'typanion';
import type { VerifiedJwt } from './auth-tokens';

const SUPPORTED_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384'] as const;
const isSupportedAlgorithm = t.isEnum(SUPPORTED_ALGORITHMS);
type SupportedAlgorithm = t.InferType<typeof isSupportedAlgorithm>;

const DEFAULT_ALLOWED_ALGORITHMS: readonly string[] = ['RS256'];
const CLOCK_TOLERANCE_SECONDS = 300;

/** How WebCrypto imports the verification key of an algorithm, and how it then verifies a signature. */
interface AlgorithmParams {
  readonly importAlgorithm: webcrypto.RsaHashedImportParams | webcrypto.EcKeyImportParams;
  readonly verifyAlgorithm: string | webcrypto.EcdsaParams;
}

const ALGORITHM_PARAMS: Record<SupportedAlgorithm, AlgorithmParams> = {
  RS256: { importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verifyAlgorithm: 'RSASSA-PKCS1-v1_5' },
  RS384: { importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }, verifyAlgorithm: 'RSASSA-PKCS1-v1_5' },
  RS512: { importAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }, verifyAlgorithm: 'RSASSA-PKCS1-v1_5' },
  ES256: { importAlgorithm: { name: 'ECDSA', namedCurve: 'P-256' }, verifyAlgorithm: { name: 'ECDSA', hash: 'SHA-256' } },
  ES384: { importAlgorithm: { name: 'ECDSA', namedCurve: 'P-384' }, verifyAlgorithm: { name: 'ECDSA', hash: 'SHA-384' } },
};

const isJwtHeader = t.isPartial({
  alg: t.isString(),
  kid: t.isOptional(t.isString()),
});

const isJwtPayload = t.isPartial({
  sub: t.isOptional(t.isString()),
  iss: t.isOptional(t.isString()),
  aud: t.isOptional(t.isOneOf([t.isString(), t.isArray(t.isString())])),
  client_id: t.isOptional(t.isString()),
  exp: t.isOptional(t.isNumber()),
  nbf: t.isOptional(t.isNumber()),
});

// A JWKS is the issuer's published document (RFC 7517); a key lists every field WebCrypto may read when importing it.
const isJwk = t.isPartial({
  kid: t.isOptional(t.isString()),
  kty: t.isOptional(t.isString()),
  use: t.isOptional(t.isString()),
  alg: t.isOptional(t.isString()),
  n: t.isOptional(t.isString()),
  e: t.isOptional(t.isString()),
  crv: t.isOptional(t.isString()),
  x: t.isOptional(t.isString()),
  y: t.isOptional(t.isString()),
});

const isJwks = t.isPartial({
  keys: t.isArray(isJwk),
});

type JwtHeader = t.InferType<typeof isJwtHeader>;
type JwtPayload = t.InferType<typeof isJwtPayload>;
type Jwk = t.InferType<typeof isJwk>;
type Jwks = t.InferType<typeof isJwks>;

interface ParsedJwt {
  readonly header: JwtHeader;
  readonly payload: JwtPayload;
  readonly signingInput: string;
  readonly signature: Buffer;
}

/**
 * Verifies JWTs against the issuers' public keys held in the auth key store. It checks the signature and the
 * time claims only; which tenant or account the token speaks for comes from the HMAC session token, so no
 * identity provider or account lookup happens here. The JWKS of an issuer and the imported verification keys
 * are cached for the lifetime of the instance, which spans the warm invocations of one Lambda container.
 */
export class JwtVerifier {
  private readonly dynamodb: DynamoDBClient;
  private readonly jwksByIssuer = new Map<string, Jwks>();
  private readonly verificationKeysByKid = new Map<string, webcrypto.CryptoKey>();

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
    authKeyStoreTable: string,
    allowedAlgorithms: string[] | undefined,
  ): Promise<VerifiedJwt | null> {
    try {
      const parsed = this.parse(token);
      if (!parsed) {
        return null;
      }
      const { header, payload, signingInput, signature } = parsed;

      const issuer = this.normalizeIssuer(payload.iss ?? '');
      if (!issuer || !header.kid) {
        return null;
      }

      if (!this.allowedAlgorithmsOrDefault(allowedAlgorithms).includes(header.alg)) {
        return null;
      }
      if (!isSupportedAlgorithm(header.alg)) {
        return null;
      }

      const verificationKey = await this.verificationKey(header.kid, header.alg, authKeyStoreTable, issuer);
      if (!(await this.signatureMatches(signingInput, signature, verificationKey, header.alg))) {
        return null;
      }

      if (!this.timeClaimsAreCurrent(payload) || !payload.sub) {
        return null;
      }

      return { sub: payload.sub, issuer, audience: this.audienceOf(payload) };
    } catch {
      return null;
    }
  }

  private parse(token: string): ParsedJwt | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    try {
      const header: unknown = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (!isJwtHeader(header) || !isJwtPayload(payload)) {
        return null;
      }

      return {
        header,
        payload,
        signingInput: `${parts[0]}.${parts[1]}`,
        signature: Buffer.from(parts[2], 'base64url'),
      };
    } catch {
      return null;
    }
  }

  private allowedAlgorithmsOrDefault(allowedAlgorithms: string[] | undefined): readonly string[] {
    return allowedAlgorithms && allowedAlgorithms.length > 0 ? allowedAlgorithms : DEFAULT_ALLOWED_ALGORITHMS;
  }

  private normalizeIssuer(issuer: string): string {
    return issuer.trim().replace(/\/+$/, '');
  }

  private async verificationKey(
    kid: string,
    algorithm: SupportedAlgorithm,
    authKeyStoreTable: string,
    issuer: string,
  ): Promise<webcrypto.CryptoKey> {
    const jwks = await this.jwksOf(issuer, authKeyStoreTable);
    const jwk = jwks.keys.find((key) => key.kid === kid);
    if (!jwk) {
      throw new Error(`Key with kid ${kid} not found in JWKS`);
    }
    return this.importVerificationKey(kid, jwk, algorithm);
  }

  private async jwksOf(issuer: string, authKeyStoreTable: string): Promise<Jwks> {
    const cached = this.jwksByIssuer.get(issuer);
    if (cached) {
      return cached;
    }

    const jwks = await this.loadJwks(issuer, authKeyStoreTable);
    this.jwksByIssuer.set(issuer, jwks);
    return jwks;
  }

  private async loadJwks(issuer: string, authKeyStoreTable: string): Promise<Jwks> {
    const response = await this.dynamodb.send(
      new GetItemCommand({
        TableName: authKeyStoreTable,
        Key: {
          pk: { S: 'jwks' },
          sk: { S: issuer },
        },
      }),
    );

    const jwksJson = response.Item?.jwks?.S;
    if (!jwksJson) {
      throw new Error(`JWKS not found in ${authKeyStoreTable} for issuer ${issuer}`);
    }

    const jwks: unknown = JSON.parse(jwksJson);
    const errors: string[] = [];
    if (!isJwks(jwks, { errors })) {
      throw new Error(`JWKS of issuer ${issuer} in ${authKeyStoreTable} is malformed: ${errors.join('; ')}`);
    }
    return jwks;
  }

  private async importVerificationKey(
    kid: string,
    jwk: Jwk,
    algorithm: SupportedAlgorithm,
  ): Promise<webcrypto.CryptoKey> {
    const cached = this.verificationKeysByKid.get(kid);
    if (cached) {
      return cached;
    }

    const key = await webcrypto.subtle.importKey(
      'jwk',
      jwk,
      ALGORITHM_PARAMS[algorithm].importAlgorithm,
      false,
      ['verify'],
    );
    this.verificationKeysByKid.set(kid, key);
    return key;
  }

  private signatureMatches(
    signingInput: string,
    signature: Buffer,
    key: webcrypto.CryptoKey,
    algorithm: SupportedAlgorithm,
  ): Promise<boolean> {
    return webcrypto.subtle.verify(
      ALGORITHM_PARAMS[algorithm].verifyAlgorithm,
      key,
      signature,
      Buffer.from(signingInput),
    );
  }

  private timeClaimsAreCurrent(payload: JwtPayload): boolean {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp !== undefined && nowSeconds > payload.exp + CLOCK_TOLERANCE_SECONDS) {
      return false;
    }
    if (payload.nbf !== undefined && nowSeconds < payload.nbf - CLOCK_TOLERANCE_SECONDS) {
      return false;
    }
    return true;
  }

  private audienceOf(payload: JwtPayload): string {
    const clientId = payload.client_id?.trim();
    if (clientId) {
      return clientId;
    }

    const audience = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    return audience || '';
  }
}
