/**
 * Fixtures shared by the data override resolver's tests: the resource properties the construct sends,
 * CloudFormation custom-resource events carrying them, and the capture of the response a
 * `wrapHandler`-wrapped handler PUTs.
 */

import type { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import { Writable }                                        from 'stream';

import type { ResourceProperties, TableRole }              from '../resource-properties';

export const SERVICE_TOKEN = 'arn:aws:lambda:eu-west-1:123456789012:function:data-override-resolver';

export function tableArn(name: string): string {
  return `arn:aws:dynamodb:eu-west-1:123456789012:table/${name}`;
}

export const INCOMING_ARNS: Record<TableRole, string> = {
  configTable: tableArn('incoming-config'),
  itemTable: tableArn('incoming-item'),
  changelogTable: tableArn('incoming-changelog'),
  auditLogTable: tableArn('incoming-auditlog'),
  mailFeedbackTable: tableArn('incoming-mailfeedback'),
};

/** The properties as CloudFormation delivers them, `ServiceToken` included, with every override equal to its incoming ARN. */
export const PROPERTIES_WITHOUT_OVERRIDES: ResourceProperties & { ServiceToken: string } = {
  ServiceToken: SERVICE_TOKEN,
  configTableIncomingArn: INCOMING_ARNS.configTable,
  configTableOverrideArn: INCOMING_ARNS.configTable,
  itemTableIncomingArn: INCOMING_ARNS.itemTable,
  itemTableOverrideArn: INCOMING_ARNS.itemTable,
  changelogTableIncomingArn: INCOMING_ARNS.changelogTable,
  changelogTableOverrideArn: INCOMING_ARNS.changelogTable,
  auditLogTableIncomingArn: INCOMING_ARNS.auditLogTable,
  auditLogTableOverrideArn: INCOMING_ARNS.auditLogTable,
  mailFeedbackTableIncomingArn: INCOMING_ARNS.mailFeedbackTable,
  mailFeedbackTableOverrideArn: INCOMING_ARNS.mailFeedbackTable,
};

const baseEvent = {
  ServiceToken: SERVICE_TOKEN,
  ResponseURL: 'https://example.com/response',
  StackId: 'arn:aws:cloudformation:eu-west-1:123456789012:stack/test-stack/guid',
  RequestId: 'request-id-1',
  LogicalResourceId: 'DataOverrideResolver',
  ResourceType: 'Custom::MailboxDataOverrideResolver',
};

export function createEvent(): CloudFormationCustomResourceEvent {
  return { ...baseEvent, RequestType: 'Create', ResourceProperties: PROPERTIES_WITHOUT_OVERRIDES };
}

export function deleteEvent(): CloudFormationCustomResourceEvent {
  return {
    ...baseEvent,
    RequestType: 'Delete',
    PhysicalResourceId: baseEvent.LogicalResourceId,
    ResourceProperties: PROPERTIES_WITHOUT_OVERRIDES,
  };
}

export function lambdaContext(): Context {
  return {
    getRemainingTimeInMillis: () => 30000,
    logStreamName: 'log-stream',
    logGroupName: 'log-group',
  } as unknown as Context;
}

/** The fields of the CloudFormation response that the handler tests assert on. */
export interface CapturedCfnResponse {
  Status: string;
  Reason?: string;
  PhysicalResourceId?: string;
  Data?: Record<string, string>;
}

/**
 * Routes the mocked `https.request` (the test file must `jest.mock('https', ...)`) into a Writable
 * and returns a function yielding the CloudFormation response body the handler PUT to ResponseURL.
 */
export function captureCfnResponse(): () => CapturedCfnResponse {
  // eslint-disable-next-line global-require
  const https = require('https');
  let body    = '';
  https.request.mockImplementation((_options: unknown, callback?: (res: { statusCode: number }) => void) => {
    if (callback) {
      callback({ statusCode: 200 });
    }
    return new Writable({
      write(chunk: Buffer, _encoding: string, done: () => void) {
        body += chunk.toString();
        done();
      },
    });
  });
  return () => JSON.parse(body) as CapturedCfnResponse;
}
