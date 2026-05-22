import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import * as crypto from 'crypto';

/**
 * Parsed HMAC token payload
 */
export interface HmacTokenPayload {
  tenantId: string;
  issuer: string;
  audience: string;
  accountIds: string[];
}

/**
 * HMAC signing keys fetched from the JWK cache table
 */
interface HmacKeys {
  current: Buffer;
  previous?: Buffer;
}

// Module-level cache for HMAC keys (persists across warm Lambda invocations)
let hmacKeysCache: { value: HmacKeys; fetchedAt: number } | null = null;

const HMAC_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch HMAC keys from the JWK cache table.
 * Uses module-level cache with 30-minute TTL.
 * Returns null if the item is absent.
 */
export async function getHmacKeys(
  dynamodb: DynamoDBClient,
  authKeyStoreTable: string,
): Promise<HmacKeys | null> {
  const now = Date.now();

  if (hmacKeysCache && now - hmacKeysCache.fetchedAt < HMAC_CACHE_TTL_MS) {
    return hmacKeysCache.value;
  }

  const response = await dynamodb.send(
    new GetItemCommand({
      TableName: authKeyStoreTable,
      Key: {
        pk: { S: 'hmac' },
        sk: { S: 'blob-url-signing' },
      },
    }),
  );

  if (!response.Item || !response.Item.current?.S) {
    return null;
  }

  const keys: HmacKeys = {
    current: Buffer.from(response.Item.current.S, 'hex'),
    ...(response.Item.previous?.S ? { previous: Buffer.from(response.Item.previous.S, 'hex') } : {}),
  };

  hmacKeysCache = { value: keys, fetchedAt: now };
  return keys;
}

/**
 * Verify a single HMAC token against one key.
 *
 * Token format (matches Go signer in session/provider.go):
 *   base64RawURL(payload) + "." + base64RawURL(HMAC-SHA256(key, payload_bytes))
 *   payload_string = "{tenantId}|{issuer}|{audience}|{accountId1,accountId2,...}"
 *
 * Returns the parsed payload on success, or null on any failure.
 */
export function verifyHmacToken(
  token: string,
  key: Buffer,
): HmacTokenPayload | null {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) {
    return null;
  }

  const payloadB64 = token.slice(0, dotIndex);
  const sigB64 = token.slice(dotIndex + 1);

  // Ensure exactly two parts (no extra dots in either segment)
  if (payloadB64.includes('.') || sigB64.includes('.')) {
    return null;
  }

  let payloadBytes: Buffer;
  let sigBytes: Buffer;
  try {
    payloadBytes = Buffer.from(payloadB64, 'base64url');
    sigBytes = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }

  const expected = crypto.createHmac('sha256', key).update(payloadBytes).digest();

  if (
    expected.length !== sigBytes.length ||
    !crypto.timingSafeEqual(expected, sigBytes)
  ) {
    return null;
  }

  const payloadStr = payloadBytes.toString('utf8');
  const parts = payloadStr.split('|');
  if (parts.length !== 4) {
    return null;
  }

  const [tenantId, issuer, audience, accountIdsStr] = parts;

  return {
    tenantId,
    issuer,
    audience,
    accountIds: accountIdsStr.split(',').filter(Boolean),
  };
}

/**
 * Verify an HMAC token with key rotation support.
 * Tries the current key first, then falls back to the previous key if present.
 * Returns the parsed payload on success, or null if verification fails.
 */
export async function verifyHmacTokenWithRotation(
  token: string,
  dynamodb: DynamoDBClient,
  authKeyStoreTable: string,
): Promise<HmacTokenPayload | null> {
  const keys = await getHmacKeys(dynamodb, authKeyStoreTable);
  if (keys === null) {
    return null;
  }

  const resultCurrent = verifyHmacToken(token, keys.current);
  if (resultCurrent !== null) {
    return resultCurrent;
  }

  if (keys.previous) {
    const resultPrevious = verifyHmacToken(token, keys.previous);
    if (resultPrevious !== null) {
      return resultPrevious;
    }
  }

  return null;
}
