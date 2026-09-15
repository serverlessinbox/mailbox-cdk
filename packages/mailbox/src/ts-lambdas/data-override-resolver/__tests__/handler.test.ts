/// <reference types="jest" />

import * as t from 'typanion';
import type {
  CloudFormationCustomResourceCreateEvent,
  CloudFormationCustomResourceDeleteEvent,
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResourcePropertiesCommon,
  Context,
} from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, DescribeTableCommand, ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { handler } from '../handler';

// wrapHandler reports the outcome by PUTting a body to the event's ResponseURL over https,
// so the CloudFormation response is observable only at that layer.
const mockSentResponseBodies: string[] = [];
jest.mock('https', () => ({
  ...jest.requireActual<typeof import('https')>('https'),
  request: (_options: unknown, onResponse: (res: { statusCode: number; headers: Record<string, string> }) => void) => {
    const chunks: string[] = [];
    return {
      on: () => undefined,
      write: (chunk: string) => {
        chunks.push(chunk);
      },
      end: () => {
        mockSentResponseBodies.push(chunks.join(''));
        onResponse({ statusCode: 200, headers: {} });
      },
    };
  },
}));

const isCfnResponse = t.isObject(
  {
    Status: t.isEnum(['SUCCESS', 'FAILED']),
    Reason: t.isOptional(t.isString()),
    Data: t.isOptional(t.isRecord(t.isString())),
  },
  { extra: t.isRecord(t.isUnknown()) },
);
type CfnResponse = t.InferType<typeof isCfnResponse>;

type Role = 'configTable' | 'itemTable' | 'changelogTable' | 'auditLogTable' | 'mailFeedbackTable';

const FUNCTION_ARN = 'arn:aws:lambda:eu-west-1:123456789012:function:data-override-resolver';
const tableArn = (name: string): string => `arn:aws:dynamodb:eu-west-1:123456789012:table/${name}`;

const incomingArns: Record<Role, string> = {
  configTable: tableArn('incoming-config'),
  itemTable: tableArn('incoming-item'),
  changelogTable: tableArn('incoming-changelog'),
  auditLogTable: tableArn('incoming-auditlog'),
  mailFeedbackTable: tableArn('incoming-mailfeedback'),
};

const OVERRIDE_ITEM_TABLE_NAME = 'override-item';
const OVERRIDE_ITEM_ARN = tableArn(OVERRIDE_ITEM_TABLE_NAME);

const validProperties: CloudFormationCustomResourceResourcePropertiesCommon = {
  ServiceToken: FUNCTION_ARN,
  configTableIncomingArn: incomingArns.configTable,
  configTableOverrideArn: incomingArns.configTable,
  itemTableIncomingArn: incomingArns.itemTable,
  itemTableOverrideArn: incomingArns.itemTable,
  changelogTableIncomingArn: incomingArns.changelogTable,
  changelogTableOverrideArn: incomingArns.changelogTable,
  auditLogTableIncomingArn: incomingArns.auditLogTable,
  auditLogTableOverrideArn: incomingArns.auditLogTable,
  mailFeedbackTableIncomingArn: incomingArns.mailFeedbackTable,
  mailFeedbackTableOverrideArn: incomingArns.mailFeedbackTable,
};

function createEvent(resourceProperties: CloudFormationCustomResourceResourcePropertiesCommon): CloudFormationCustomResourceCreateEvent {
  return {
    RequestType: 'Create',
    ServiceToken: FUNCTION_ARN,
    ResponseURL: 'https://cloudformation-custom-resource-response.example.com/response',
    StackId: 'arn:aws:cloudformation:eu-west-1:123456789012:stack/test-stack/guid',
    RequestId: 'request-id-1',
    LogicalResourceId: 'DataOverrideResolver',
    ResourceType: 'Custom::MailboxDataOverrideResolver',
    ResourceProperties: resourceProperties,
  };
}

const context: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'data-override-resolver',
  functionVersion: '$LATEST',
  invokedFunctionArn: FUNCTION_ARN,
  memoryLimitInMB: '256',
  awsRequestId: 'aws-request-id',
  logGroupName: '/aws/lambda/data-override-resolver',
  logStreamName: 'log-stream',
  getRemainingTimeInMillis: () => 60000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
};

async function invoke(event: CloudFormationCustomResourceEvent): Promise<CfnResponse> {
  await handler(event, context);
  expect(mockSentResponseBodies).toHaveLength(1);
  const body: unknown = JSON.parse(mockSentResponseBodies[0]);
  const errors: string[] = [];
  if (!isCfnResponse(body, { errors })) {
    throw new Error(`Unexpected CloudFormation response body: ${errors.join('; ')}`);
  }
  return body;
}

describe('data-override-resolver handler', () => {
  const dynamodbMock = mockClient(DynamoDBClient);

  function describeTableNames(): Array<string | undefined> {
    return dynamodbMock.commandCalls(DescribeTableCommand).map((call) => call.args[0].input.TableName);
  }

  function expectDataArns(expected: Record<Role, string>, response: CfnResponse): void {
    expect(response.Data).toEqual({
      configTableArn: expected.configTable,
      itemTableArn: expected.itemTable,
      changelogTableArn: expected.changelogTable,
      auditLogTableArn: expected.auditLogTable,
      mailFeedbackTableArn: expected.mailFeedbackTable,
    });
  }

  beforeEach(() => {
    mockSentResponseBodies.length = 0;
    dynamodbMock.reset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses all incoming ARNs when all overrides equal incoming, makes no DescribeTable calls', async () => {
    const response = await invoke(createEvent(validProperties));

    expect(response.Status).toBe('SUCCESS');
    expectDataArns(incomingArns, response);
    expect(describeTableNames()).toEqual([]);
  });

  it('validates all incoming ARN, override ARN properties are present and rejects with details if missing', async () => {
    const withoutItemTableIncoming: CloudFormationCustomResourceResourcePropertiesCommon = {
      ServiceToken: FUNCTION_ARN,
      configTableIncomingArn: incomingArns.configTable,
      configTableOverrideArn: incomingArns.configTable,
      // itemTableIncomingArn missing
      itemTableOverrideArn: incomingArns.itemTable,
      changelogTableIncomingArn: incomingArns.changelogTable,
      changelogTableOverrideArn: incomingArns.changelogTable,
      auditLogTableIncomingArn: incomingArns.auditLogTable,
      auditLogTableOverrideArn: incomingArns.auditLogTable,
      mailFeedbackTableIncomingArn: incomingArns.mailFeedbackTable,
      mailFeedbackTableOverrideArn: incomingArns.mailFeedbackTable,
    };

    const response = await invoke(createEvent(withoutItemTableIncoming));

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('Invalid ResourceProperties');
    expect(response.Reason).toContain('itemTableIncomingArn');
  });

  describe('when itemTable override differs from incoming', () => {
    beforeEach(() => {
      dynamodbMock.on(DescribeTableCommand).rejects(
        new ResourceNotFoundException({ $metadata: {}, message: 'Resource not found' })
      );
    });

    it('calls DescribeTable on override table and uses override if ACTIVE', async () => {
      const propsWithOverride: CloudFormationCustomResourceResourcePropertiesCommon = {
        ...validProperties,
        itemTableOverrideArn: OVERRIDE_ITEM_ARN,
      };

      dynamodbMock
        .on(DescribeTableCommand, { TableName: OVERRIDE_ITEM_TABLE_NAME })
        .resolves({ Table: { TableName: OVERRIDE_ITEM_TABLE_NAME, TableStatus: 'ACTIVE' } });

      const response = await invoke(createEvent(propsWithOverride));

      expect(response.Status).toBe('SUCCESS');
      expectDataArns({ ...incomingArns, itemTable: OVERRIDE_ITEM_ARN }, response);
      expect(describeTableNames()).toContain(OVERRIDE_ITEM_TABLE_NAME);
    });

    it('fails naming role and override ARN when override table does not exist', async () => {
      const propsWithOverride: CloudFormationCustomResourceResourcePropertiesCommon = {
        ...validProperties,
        itemTableOverrideArn: OVERRIDE_ITEM_ARN,
      };

      dynamodbMock
        .on(DescribeTableCommand, { TableName: OVERRIDE_ITEM_TABLE_NAME })
        .rejects(new ResourceNotFoundException({ $metadata: {}, message: 'Requested resource not found' }));

      const response = await invoke(createEvent(propsWithOverride));

      expect(response.Status).toBe('FAILED');
      expect(response.Reason).toContain('itemTable');
      expect(response.Reason).toContain(OVERRIDE_ITEM_ARN);
      expect(response.Reason).toContain('does not exist');
    });

    it('fails naming role, override ARN, and status when override table is not ACTIVE', async () => {
      const propsWithOverride: CloudFormationCustomResourceResourcePropertiesCommon = {
        ...validProperties,
        itemTableOverrideArn: OVERRIDE_ITEM_ARN,
      };

      dynamodbMock
        .on(DescribeTableCommand, { TableName: OVERRIDE_ITEM_TABLE_NAME })
        .resolves({ Table: { TableName: OVERRIDE_ITEM_TABLE_NAME, TableStatus: 'CREATING' } });

      const response = await invoke(createEvent(propsWithOverride));

      expect(response.Status).toBe('FAILED');
      expect(response.Reason).toContain('itemTable');
      expect(response.Reason).toContain(OVERRIDE_ITEM_ARN);
      expect(response.Reason).toContain('CREATING');
    });
  });

  it('succeeds on Delete without any DynamoDB calls', async () => {
    const event: CloudFormationCustomResourceDeleteEvent = {
      ...createEvent(validProperties),
      RequestType: 'Delete',
      PhysicalResourceId: 'DataOverrideResolver',
    };

    const response = await invoke(event);

    expect(response.Status).toBe('SUCCESS');
    expect(dynamodbMock.calls()).toHaveLength(0);
  });
});
