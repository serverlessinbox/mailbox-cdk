import { DynamoDBClient, GetItemCommand, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { toTenantId, type TableName }                          from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import * as crypto                                             from 'crypto';

import type { PatVerdict }                                     from './auth-tokens';
import { PatVerdictCache }                                     from './pat-verdict-cache';

/** The attributes of a personal access token lookup row that the verdict reads. */
interface LookupRow {
  readonly tenantId?:  AttributeValue;
  readonly tokenId?:   AttributeValue;
  readonly expiresAt?: AttributeValue;
  readonly revokedAt?: AttributeValue;
}

/**
 * Decides whether a presented personal access token secret may authorize a blob download, from the lookup row keyed
 * by the hash of the secret. Verdicts are held per table in a `PatVerdictCache`, so a repeated secret is not read on
 * every request.
 */
export class PatVerifier {
  private readonly dynamodb: DynamoDBClient;
  private readonly now: () => number;
  private readonly cachesByTable = new Map<TableName, PatVerdictCache>();

  constructor(dynamodb: DynamoDBClient, now: () => number) {
    this.dynamodb = dynamodb;
    this.now      = now;
  }

  /**
   * The verdict on a presented secret. The secret is hashed here, and only the hash reaches the table or the cache.
   * A failed read throws an error that names neither the secret nor its hash.
   */
  public verdict(secret: string, patTable: TableName): Promise<PatVerdict> {
    const hash = crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
    return this.cacheFor(patTable).verdictFor(hash, () => this.readVerdict(patTable, hash));
  }

  private cacheFor(patTable: TableName): PatVerdictCache {
    const existing = this.cachesByTable.get(patTable);
    if (existing) {
      return existing;
    }

    const created = new PatVerdictCache(this.now);
    this.cachesByTable.set(patTable, created);
    return created;
  }

  private async readVerdict(patTable: TableName, hash: string): Promise<PatVerdict> {
    const row = await this.readLookupRow(patTable, hash);
    if (row === undefined) {
      return { usable: false, reason: 'not-found' };
    }
    return this.verdictOf(row);
  }

  private async readLookupRow(patTable: TableName, hash: string): Promise<LookupRow | undefined> {
    try {
      const response = await this.dynamodb.send(
        new GetItemCommand({
          TableName:            patTable,
          Key:                  { 'pk': { S: `PAT#${hash}` }, 'sk': { S: 'TOKEN' } },
          ProjectionExpression: 'tenantId, tokenId, expiresAt, revokedAt',
        }),
      );
      return response.Item;
    } catch (thrown) {
      throw new Error(`Reading a personal access token lookup row failed: ${this.errorNameOf(thrown)}`);
    }
  }

  private verdictOf(row: LookupRow): PatVerdict {
    const tenantId  = row.tenantId?.S;
    const tokenId   = row.tokenId?.S;
    const expiresAt = Date.parse(row.expiresAt?.S ?? '');
    if (!tenantId || !tokenId || Number.isNaN(expiresAt)) {
      return { usable: false, reason: 'unparsable' };
    }
    if (row.revokedAt !== undefined) {
      return { usable: false, reason: 'revoked' };
    }
    if (this.now() >= expiresAt) {
      return { usable: false, reason: 'expired' };
    }
    return { usable: true, tenantId: toTenantId(tenantId), tokenId, expiresAt };
  }

  private errorNameOf(thrown: unknown): string {
    return thrown instanceof Error ? thrown.name : 'non-error value';
  }
}
