/**
 * Pins what the edge reads for a presented personal access token secret: the lookup row keyed by the SHA-256 hex of the
 * full secret, the attributes it projects, and the verdict each row state gives. The row is written by the Go services,
 * so the key and the attribute names are the Go writer's. A secret or its hash that leaked into a thrown message would
 * reach the viewer's logs, so the failure assertion checks both.
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { toTableName, toTenantId }        from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                     from 'aws-sdk-client-mock';

import { PatVerifier }                    from '../pat-verifier';

const PAT_TABLE   = toTableName('pat-table');
const FAKE_SECRET = `sipat_${'a'.repeat(49)}`;
// SHA-256 hex of FAKE_SECRET: the lookup key is the hash of the full 55-character secret (token_secret.go, Hash).
const SECRET_HASH = '83c6bccaea05faee8e7a3ecd1d31a9cf01872c1c4c4811e661085b5a906633e3';

const NOW = Date.parse('2026-11-02T12:00:00Z');

const ONE_HOUR_LATER = '2026-11-02T13:00:00.123456789Z';
const ONE_HOUR_AGO   = '2026-11-02T11:00:00Z';

describe('PatVerifier', () => {
  const dynamodb = mockClient(DynamoDBClient);

  let verifier: PatVerifier;

  function lookupRowHolds(attributes: Record<string, { S: string }>): void {
    dynamodb.on(GetItemCommand).resolves({ Item: attributes });
  }

  const usableRow = { tenantId: { S: 'tenant-1' }, tokenId: { S: 'pat_1' }, expiresAt: { S: ONE_HOUR_LATER } };

  beforeEach(() => {
    dynamodb.reset();
    verifier = new PatVerifier(new DynamoDBClient({}), () => NOW);
  });

  it('reads the lookup row keyed by the SHA-256 hex of the full secret, projecting only the attributes the verdict reads', async () => {
    lookupRowHolds(usableRow);

    await verifier.verdict(FAKE_SECRET, PAT_TABLE);

    expect(dynamodb.commandCalls(GetItemCommand)[0].args[0].input).toEqual({
      TableName:            PAT_TABLE,
      Key:                  { 'pk': { S: `PAT#${SECRET_HASH}` }, 'sk': { S: 'TOKEN' } },
      ProjectionExpression: 'tenantId, tokenId, expiresAt, revokedAt',
    });
  });

  it('is usable with the tenant, token and expiry of a row that is current', async () => {
    lookupRowHolds(usableRow);

    await expect(verifier.verdict(FAKE_SECRET, PAT_TABLE)).resolves.toEqual({
      usable:    true,
      tenantId:  toTenantId('tenant-1'),
      tokenId:   'pat_1',
      expiresAt: Date.parse(ONE_HOUR_LATER),
    });
  });

  it('is not usable when no row has the secret\'s hash', async () => {
    dynamodb.on(GetItemCommand).resolves({});

    await expect(verifier.verdict(FAKE_SECRET, PAT_TABLE)).resolves.toEqual({ usable: false, reason: 'not-found' });
  });

  it('is not usable when the row is revoked, even before its expiry', async () => {
    lookupRowHolds({ ...usableRow, revokedAt: { S: ONE_HOUR_AGO } });

    await expect(verifier.verdict(FAKE_SECRET, PAT_TABLE)).resolves.toEqual({ usable: false, reason: 'revoked' });
  });

  it('is not usable once the row has expired', async () => {
    lookupRowHolds({ ...usableRow, expiresAt: { S: ONE_HOUR_AGO } });

    await expect(verifier.verdict(FAKE_SECRET, PAT_TABLE)).resolves.toEqual({ usable: false, reason: 'expired' });
  });

  it.each([
    { state: 'has an expiry that is not a time', attributes: { ...usableRow, expiresAt: { S: 'next tuesday' } } },
    { state: 'has no tenant', attributes: { tokenId: { S: 'pat_1' }, expiresAt: { S: ONE_HOUR_LATER } } },
  ])('is not usable when the row $state', async ({ attributes }) => {
    lookupRowHolds(attributes);

    await expect(verifier.verdict(FAKE_SECRET, PAT_TABLE)).resolves.toEqual({ usable: false, reason: 'unparsable' });
  });

  it('throws a read failure without the secret or its hash in its message', async () => {
    const failure = new Error(`ValidationException: key PAT#${SECRET_HASH} ${FAKE_SECRET}`);
    failure.name  = 'ProvisionedThroughputExceededException';
    dynamodb.on(GetItemCommand).rejects(failure);

    const thrown = await verifier.verdict(FAKE_SECRET, PAT_TABLE).then(() => undefined, (error: unknown) => error);

    expect(thrown).toEqual(new Error('Reading a personal access token lookup row failed: ProvisionedThroughputExceededException'));
  });

  it('holds a verdict per table, so a repeated secret is not read again', async () => {
    lookupRowHolds(usableRow);

    await verifier.verdict(FAKE_SECRET, PAT_TABLE);
    await verifier.verdict(FAKE_SECRET, PAT_TABLE);

    expect(dynamodb.commandCalls(GetItemCommand)).toHaveLength(1);
  });
});
