/**
 * Coverage for TableOverrideResolver. The resolver decides which table backs each data role: a wrong
 * answer either ignores the operator's restored table or points the mailbox at a table that cannot
 * serve it. These tests pin the incoming/override decision, the existence and ACTIVE checks on an
 * override, and which failures are expected (answered by their reason, no trace flush) versus
 * unexpected (a schema mismatch or a DynamoDB failure, which the handler flushes).
 */

import { DynamoDBClient, DescribeTableCommand, ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { ExpectedFailure, LoggerBuffer }                                   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                                      from 'aws-sdk-client-mock';

import { TableOverrideResolver }                                           from '../table-override-resolver';

import { INCOMING_ARNS, PROPERTIES_WITHOUT_OVERRIDES, tableArn }           from './data-override-resolver-helpers';

const OVERRIDE_ITEM_TABLE_NAME      = 'override-item';
const OVERRIDE_ITEM_ARN             = tableArn(OVERRIDE_ITEM_TABLE_NAME);
const PROPERTIES_WITH_ITEM_OVERRIDE = { ...PROPERTIES_WITHOUT_OVERRIDES, itemTableOverrideArn: OVERRIDE_ITEM_ARN };

describe('TableOverrideResolver', () => {
  const dynamodbMock = mockClient(DynamoDBClient);
  let consoleInfo: jest.SpyInstance;
  let resolver: TableOverrideResolver;

  beforeEach(() => {
    dynamodbMock.reset();
    consoleInfo = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    resolver    = new TableOverrideResolver(new DynamoDBClient({ region: 'eu-west-1' }), new LoggerBuffer('test', 'info'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps every incoming table when no override differs, without describing any table', async () => {
    const arns = await resolver.resolve(PROPERTIES_WITHOUT_OVERRIDES);

    expect(arns).toEqual({
      configTableArn: INCOMING_ARNS.configTable,
      itemTableArn: INCOMING_ARNS.itemTable,
      changelogTableArn: INCOMING_ARNS.changelogTable,
      auditLogTableArn: INCOMING_ARNS.auditLogTable,
      mailFeedbackTableArn: INCOMING_ARNS.mailFeedbackTable,
    });
    expect(dynamodbMock.calls()).toHaveLength(0);
    expect(consoleInfo).toHaveBeenCalledWith('itemTable: override matches incoming, using incoming table', { service: 'test' });
  });

  it('rejects properties missing a required key with an error naming the key', async () => {
    const { itemTableIncomingArn: _omitted, ...withoutItemTableIncoming } = PROPERTIES_WITHOUT_OVERRIDES;

    const rejection = resolver.resolve(withoutItemTableIncoming);

    await expect(rejection).rejects.toThrow(/Invalid ResourceProperties.*itemTableIncomingArn/);
    await expect(rejection).rejects.not.toBeInstanceOf(ExpectedFailure);
  });

  describe('when the item table override differs from the incoming table', () => {
    it('uses the override when its table is ACTIVE, describing it by table name', async () => {
      dynamodbMock
        .on(DescribeTableCommand, { TableName: OVERRIDE_ITEM_TABLE_NAME })
        .resolves({ Table: { TableName: OVERRIDE_ITEM_TABLE_NAME, TableStatus: 'ACTIVE' } });

      const arns = await resolver.resolve(PROPERTIES_WITH_ITEM_OVERRIDE);

      expect(arns).toEqual({
        configTableArn: INCOMING_ARNS.configTable,
        itemTableArn: OVERRIDE_ITEM_ARN,
        changelogTableArn: INCOMING_ARNS.changelogTable,
        auditLogTableArn: INCOMING_ARNS.auditLogTable,
        mailFeedbackTableArn: INCOMING_ARNS.mailFeedbackTable,
      });
      expect(dynamodbMock.commandCalls(DescribeTableCommand)).toHaveLength(1);
      expect(consoleInfo).toHaveBeenCalledWith(`itemTable: using override table ${OVERRIDE_ITEM_ARN}`, { service: 'test' });
    });

    it('rejects with an ExpectedFailure naming the role and ARN when the override table does not exist', async () => {
      dynamodbMock.on(DescribeTableCommand).rejects(new ResourceNotFoundException({ $metadata: {}, message: 'Requested resource not found' }));

      const rejection = resolver.resolve(PROPERTIES_WITH_ITEM_OVERRIDE);

      await expect(rejection).rejects.toBeInstanceOf(ExpectedFailure);
      await expect(rejection).rejects.toThrow(`itemTable: override table ${OVERRIDE_ITEM_ARN} does not exist`);
    });

    it('rejects with an ExpectedFailure naming the role, ARN and status when the override table is not ACTIVE', async () => {
      dynamodbMock.on(DescribeTableCommand).resolves({ Table: { TableName: OVERRIDE_ITEM_TABLE_NAME, TableStatus: 'CREATING' } });

      const rejection = resolver.resolve(PROPERTIES_WITH_ITEM_OVERRIDE);

      await expect(rejection).rejects.toBeInstanceOf(ExpectedFailure);
      await expect(rejection).rejects.toThrow(`itemTable: override table ${OVERRIDE_ITEM_ARN} is not ACTIVE (status: CREATING)`);
    });

    it('reports the status as unknown when DynamoDB describes no table', async () => {
      dynamodbMock.on(DescribeTableCommand).resolves({});

      await expect(resolver.resolve(PROPERTIES_WITH_ITEM_OVERRIDE)).rejects.toThrow('(status: unknown)');
    });

    it('rejects with an ExpectedFailure naming the role, without calling DynamoDB, when the override is not an ARN', async () => {
      const rejection = resolver.resolve({ ...PROPERTIES_WITHOUT_OVERRIDES, itemTableOverrideArn: 'not-an-arn' });

      await expect(rejection).rejects.toBeInstanceOf(ExpectedFailure);
      await expect(rejection).rejects.toThrow('itemTable: override is malformed: Invalid ARN "not-an-arn"');
      expect(dynamodbMock.calls()).toHaveLength(0);
    });

    it.each([
      ['another service', 'arn:aws:sqs:eu-west-1:123456789012:table/override-item'],
      ['a table index', `${OVERRIDE_ITEM_ARN}/index/by-date`],
      ['a table stream', `${OVERRIDE_ITEM_ARN}/stream/2026-01-01T00:00:00.000`],
    ])('rejects with an ExpectedFailure, without calling DynamoDB, when the override is the ARN of %s', async (_kind, overrideArn) => {
      const rejection = resolver.resolve({ ...PROPERTIES_WITHOUT_OVERRIDES, itemTableOverrideArn: overrideArn });

      await expect(rejection).rejects.toBeInstanceOf(ExpectedFailure);
      await expect(rejection).rejects.toThrow(`itemTable: override ${overrideArn} is not a DynamoDB table ARN`);
      expect(dynamodbMock.calls()).toHaveLength(0);
    });

    it('passes any other DynamoDB failure through unchanged as an unexpected error', async () => {
      const accessDenied = new Error('not authorized to perform dynamodb:DescribeTable');
      dynamodbMock.on(DescribeTableCommand).rejects(accessDenied);

      await expect(resolver.resolve(PROPERTIES_WITH_ITEM_OVERRIDE)).rejects.toBe(accessDenied);
    });
  });
});
