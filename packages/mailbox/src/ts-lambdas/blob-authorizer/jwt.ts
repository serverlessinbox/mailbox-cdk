import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import * as crypto from 'crypto';

// In-memory cache for JWKS (persists across warm Lambda invocations)
const jwksCache: Map<string, { keys: any[] }> = new Map();

interface JWK {
  kty: string;
  kid: string;
  use?: string;
  n: string;
  e: string;
  alg?: string;
}

/**
 * Get JWKS from DynamoDB (with in-memory caching)
 */
async function getJWKS(
  dynamodb: DynamoDBClient,
  jwkCacheTable: string,
  issuer: string
): Promise<{ keys: JWK[] }> {
  const issuerNorm = normalizeIssuer(issuer);
  if (!issuerNorm) {
    throw new Error('issuer is required');
  }

  // Return cached value if available (warm Lambda)
  const cached = jwksCache.get(issuerNorm);
  if (cached) {
    return cached;
  }

  // Get from DynamoDB
  const command = new GetItemCommand({
    TableName: jwkCacheTable,
    Key: {
      id: { S: issuer },
    },
  });

  const response = await dynamodb.send(command);

  if (!response.Item || !response.Item.value?.S) {
    throw new Error('JWKS not found in cache');
  }

  const jwks = JSON.parse(response.Item.value.S);

  // Cache for subsequent invocations
  jwksCache.set(issuerNorm, jwks);

  return jwks;
}

function normalizeIssuer(issuer: string): string {
  return (issuer || '').trim().replace(/\/+$/, '');
}

// Local JWT types (replaces jsonwebtoken types)
type JwtPayload = Record<string, any> & {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
};

type JwtHeader = {
  alg: string;
  kid?: string;
  typ?: string;
};

// Cache for imported CryptoKey objects (persists across warm invocations — avoids re-import)
const cryptoKeyCache: Map<string, any> = new Map();

/**
 * Parse a JWT into its constituent parts without verification.
 */
function parseJWT(token: string): {
  header: JwtHeader;
  payload: JwtPayload;
  signingInput: string;
  signature: Buffer;
} | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as JwtHeader;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JwtPayload;
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

/**
 * Import a JWK as a CryptoKey for use with crypto.subtle.verify.
 * Result is cached per kid to avoid re-import on warm invocations.
 */
async function importCryptoKey(jwk: JWK, alg: string): Promise<any> {
  const cached = cryptoKeyCache.get(jwk.kid);
  if (cached) return cached;

  const subtle = (crypto as any).webcrypto.subtle as any;
  let key: any;

  if (alg === 'RS256' || alg === 'RS384' || alg === 'RS512') {
    const hash = alg === 'RS256' ? 'SHA-256' : alg === 'RS384' ? 'SHA-384' : 'SHA-512';
    key = await subtle.importKey('jwk', jwk as any, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
  } else if (alg === 'ES256') {
    key = await subtle.importKey('jwk', jwk as any, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } else if (alg === 'ES384') {
    key = await subtle.importKey('jwk', jwk as any, { name: 'ECDSA', namedCurve: 'P-384' }, false, ['verify']);
  } else {
    throw new Error(`Unsupported algorithm: ${alg}`);
  }

  cryptoKeyCache.set(jwk.kid, key);
  return key;
}

/**
 * Verify a JWT signature using crypto.subtle.
 */
async function verifyJWTSignature(
  signingInput: string,
  signature: Buffer,
  key: any,
  alg: string,
): Promise<boolean> {
  try {
    const subtle = (crypto as any).webcrypto.subtle as any;
    if (alg === 'RS256' || alg === 'RS384' || alg === 'RS512') {
      return await subtle.verify('RSASSA-PKCS1-v1_5', key, signature, Buffer.from(signingInput)) as boolean;
    } else if (alg === 'ES256' || alg === 'ES384') {
      const hash = alg === 'ES256' ? 'SHA-256' : 'SHA-384';
      return await subtle.verify({ name: 'ECDSA', hash }, key, signature, Buffer.from(signingInput)) as boolean;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Validate standard JWT claims (exp, nbf, iss).
 */
function validateClaims(payload: JwtPayload, options: { issuer?: string; clockTolerance?: number }): boolean {
  const now = Math.floor(Date.now() / 1000);
  const tol = options.clockTolerance ?? 0;
  if (typeof payload.exp === 'number' && now > payload.exp + tol) return false;
  if (typeof payload.nbf === 'number' && now < payload.nbf - tol) return false;
  if (options.issuer && normalizeIssuer(payload.iss ?? '') !== options.issuer) return false;
  return true;
}

/**
 * Get signing key by kid (key ID), as a CryptoKey ready for crypto.subtle.verify.
 */
async function getSigningKey(
  kid: string,
  alg: string,
  dynamodb: DynamoDBClient,
  jwkCacheTable: string,
  issuer: string,
): Promise<any> {
  const jwks = await getJWKS(dynamodb, jwkCacheTable, issuer);
  const key = jwks.keys.find((k: JWK) => k.kid === kid);
  if (!key) {
    throw new Error(`Key with kid ${kid} not found in JWKS`);
  }
  return importCryptoKey(key, alg);
}

/**
 * Verify JWT signature and claims without performing any IDP or account DDB lookups.
 * Used in the HMAC path where tenant/account identity comes from the auth token.
 */
export async function verifyJWTSignatureOnly(
  token: string,
  dynamodb: DynamoDBClient,
  jwkCacheTable: string,
  jwtAlgorithms?: string[],
): Promise<{ sub: string; issuer: string; audience: string } | null> {
  try {
    const parsed = parseJWT(token);
    if (!parsed) return null;
    const { header, payload, signingInput, signature } = parsed;

    const issuerFromToken = normalizeIssuer((payload.iss as string | undefined) ?? '');
    if (!issuerFromToken) return null;
    if (!header.kid) return null;

    const allowedAlgorithms = (jwtAlgorithms && jwtAlgorithms.length > 0) ? jwtAlgorithms : ['RS256'];
    if (!allowedAlgorithms.includes(header.alg)) return null;

    const cryptoKey = await getSigningKey(header.kid, header.alg, dynamodb, jwkCacheTable, issuerFromToken);
    const valid = await verifyJWTSignature(signingInput, signature, cryptoKey, header.alg);
    if (!valid) return null;

    if (!validateClaims(payload, { clockTolerance: 300 })) return null;

    const sub = payload.sub;
    if (!sub) return null;

    const audience = (payload.client_id as string | undefined)?.trim() ||
      (Array.isArray(payload.aud) ? payload.aud[0] : payload.aud as string | undefined) || '';

    return { sub, issuer: issuerFromToken, audience };
  } catch {
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}
