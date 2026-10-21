import { DynamoDBClient, GetItemCommand }                    from '@aws-sdk/client-dynamodb';
import { toAccountId, toIssuer, toTenantId, type TableName } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import * as crypto                                           from 'crypto';

import { toAudience }                                        from '../auth-identifiers';
import type { HmacTokenPayload }                             from './auth-tokens';

const HMAC_KEYS_TTL_MS          = 30 * 60 * 1000;
const SESSION_TOKEN_FIELD_COUNT = 4;

/**
 * The HMAC signing keys of the auth key store: `current` signs new tokens, `previous` is still accepted while
 * a key rotation is in flight and is absent otherwise.
 */
interface HmacKeys {
  readonly current: Buffer;
  readonly previous?: Buffer;
}

interface CachedHmacKeys {
  readonly keys: HmacKeys;
  readonly fetchedAt: number;
}

/**
 * Verifies the HMAC-signed values the Go services issue: the session token that names the accounts a bearer
 * may read, and the per-blob MAC of an email blob id. Both are signed with the same auth key store entry, tried
 * with the current key and then the previous one. The keys are cached per auth key store table for the lifetime
 * of the instance, which spans the warm invocations of one Lambda container, and each table's keys are re-read
 * thirty minutes after they were read.
 */
export class HmacVerifier {
  private readonly dynamodb: DynamoDBClient;
  private readonly cachedKeysByTable = new Map<TableName, CachedHmacKeys>();

  constructor(dynamodb: DynamoDBClient) {
    this.dynamodb = dynamodb;
  }

  /**
   * The payload of a session token signed by a current or previous key; a token signed by neither, and a
   * store without keys, have none. Token format:
   * `base64RawURL(payload) + "." + base64RawURL(HMAC-SHA256(key, payload))`, with the payload string
   * `{tenantId}|{issuer}|{audience}|{accountId1,accountId2,...}`.
   */
  public async verifySessionToken(token: string, authKeyStoreTable: TableName): Promise<HmacTokenPayload | null> {
    const keys = await this.hmacKeys(authKeyStoreTable);
    if (keys === null) {
      return null;
    }

    const signedByCurrent = this.sessionTokenPayloadSignedBy(token, keys.current);
    if (signedByCurrent !== null) {
      return signedByCurrent;
    }

    return keys.previous ? this.sessionTokenPayloadSignedBy(token, keys.previous) : null;
  }

  /**
   * Whether a blob id's MAC, `base64url(HMAC-SHA256(key, payload))` without padding, was made over `payload` by a
   * current or previous key; a store without keys verifies nothing.
   */
  public async verifyBlobMac(payload: string, macBase64Url: string, authKeyStoreTable: TableName): Promise<boolean> {
    const keys = await this.hmacKeys(authKeyStoreTable);
    if (keys === null) {
      return false;
    }

    if (this.blobMacMatches(payload, macBase64Url, keys.current)) {
      return true;
    }

    return keys.previous !== undefined && this.blobMacMatches(payload, macBase64Url, keys.previous);
  }

  private async hmacKeys(authKeyStoreTable: TableName): Promise<HmacKeys | null> {
    const now    = Date.now();
    const cached = this.cachedKeysByTable.get(authKeyStoreTable);
    if (cached && now - cached.fetchedAt < HMAC_KEYS_TTL_MS) {
      return cached.keys;
    }

    const keys = await this.loadHmacKeys(authKeyStoreTable);
    if (keys !== null) {
      this.cachedKeysByTable.set(authKeyStoreTable, { keys, fetchedAt: now });
    }
    return keys;
  }

  private async loadHmacKeys(authKeyStoreTable: TableName): Promise<HmacKeys | null> {
    const response = await this.dynamodb.send(
      new GetItemCommand({
        TableName: authKeyStoreTable,
        Key: {
          pk: { S: 'hmac' },
          sk: { S: 'blob-url-signing' },
        },
      }),
    );

    const currentHex = response.Item?.current?.S;
    if (!currentHex) {
      return null;
    }

    const previousHex = response.Item?.previous?.S;
    return {
      current: Buffer.from(currentHex, 'hex'),
      ...(previousHex ? { previous: Buffer.from(previousHex, 'hex') } : {}),
    };
  }

  private sessionTokenPayloadSignedBy(token: string, key: Buffer): HmacTokenPayload | null {
    const dotIndex = token.indexOf('.');
    if (dotIndex === -1) {
      return null;
    }

    const payloadBase64   = token.slice(0, dotIndex);
    const signatureBase64 = token.slice(dotIndex + 1);
    if (payloadBase64.includes('.') || signatureBase64.includes('.')) {
      return null;
    }

    const payloadBytes = Buffer.from(payloadBase64, 'base64url');
    const signature    = Buffer.from(signatureBase64, 'base64url');
    if (!this.signatureMatches(payloadBytes, signature, key)) {
      return null;
    }

    const fields = payloadBytes.toString('utf8').split('|');
    if (fields.length !== SESSION_TOKEN_FIELD_COUNT) {
      return null;
    }

    const [tenantId, issuer, audience, accountIds] = fields;
    return {
      tenantId: toTenantId(tenantId),
      issuer: toIssuer(issuer),
      audience: toAudience(audience),
      accountIds: accountIds.split(',').filter(Boolean).map(toAccountId),
    };
  }

  private blobMacMatches(payload: string, macBase64Url: string, key: Buffer): boolean {
    return this.signatureMatches(Buffer.from(payload, 'utf8'), Buffer.from(macBase64Url, 'base64url'), key);
  }

  private signatureMatches(signed: Buffer, signature: Buffer, key: Buffer): boolean {
    const expected = crypto.createHmac('sha256', key).update(signed).digest();
    return expected.length === signature.length && crypto.timingSafeEqual(expected, signature);
  }
}
