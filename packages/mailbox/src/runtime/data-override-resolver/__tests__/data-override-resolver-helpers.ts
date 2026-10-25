/**
 * Fixtures shared by the data override resolver's tests: the resource properties the construct sends, with the
 * `ServiceTimeout` the construct adds, and CloudFormation custom-resource events carrying them.
 */

import type { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';

import type { ResourceProperties, TableRole }              from '../resource-properties-contract';

export const SERVICE_TOKEN = 'arn:aws:lambda:eu-west-1:123456789012:function:data-override-resolver';

export function tableArn(name: string): string {
  return `arn:aws:dynamodb:eu-west-1:123456789012:table/${name}`;
}

export const INCOMING_ARNS: Record<TableRole, string> = {
  configTable:       tableArn('incoming-config'),
  itemTable:         tableArn('incoming-item'),
  changelogTable:    tableArn('incoming-changelog'),
  auditLogTable:     tableArn('incoming-auditlog'),
  mailFeedbackTable: tableArn('incoming-mailfeedback'),
};

/**
 * The properties as CloudFormation delivers them, `ServiceToken` and `ServiceTimeout` included, with every
 * override equal to its incoming ARN. The keys and the timeout are the ones the construct's synthesized template sends.
 */
export const PROPERTIES_WITHOUT_OVERRIDES: ResourceProperties & { ServiceToken: string; ServiceTimeout: string } = {
  ServiceToken:                 SERVICE_TOKEN,
  ServiceTimeout:               '120',
  configTableIncomingArn:       INCOMING_ARNS.configTable,
  configTableOverrideArn:       INCOMING_ARNS.configTable,
  itemTableIncomingArn:         INCOMING_ARNS.itemTable,
  itemTableOverrideArn:         INCOMING_ARNS.itemTable,
  changelogTableIncomingArn:    INCOMING_ARNS.changelogTable,
  changelogTableOverrideArn:    INCOMING_ARNS.changelogTable,
  auditLogTableIncomingArn:     INCOMING_ARNS.auditLogTable,
  auditLogTableOverrideArn:     INCOMING_ARNS.auditLogTable,
  mailFeedbackTableIncomingArn: INCOMING_ARNS.mailFeedbackTable,
  mailFeedbackTableOverrideArn: INCOMING_ARNS.mailFeedbackTable,
};

const baseEvent = {
  ServiceToken:      SERVICE_TOKEN,
  ResponseURL:       'https://example.com/response',
  StackId:           'arn:aws:cloudformation:eu-west-1:123456789012:stack/test-stack/guid',
  RequestId:         'request-id-1',
  LogicalResourceId: 'DataOverrideResolver',
  ResourceType:      'Custom::MailboxDataOverrideResolver',
};

export function createEvent(): CloudFormationCustomResourceEvent {
  return { ...baseEvent, RequestType: 'Create', ResourceProperties: PROPERTIES_WITHOUT_OVERRIDES };
}

export function deleteEvent(): CloudFormationCustomResourceEvent {
  return {
    ...baseEvent,
    RequestType:        'Delete',
    PhysicalResourceId: baseEvent.LogicalResourceId,
    ResourceProperties: PROPERTIES_WITHOUT_OVERRIDES,
  };
}

/** A Lambda context that carries only the fields the handler passes on. */
export function lambdaContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName:                   'data-override-resolver',
    functionVersion:                '$LATEST',
    invokedFunctionArn:             SERVICE_TOKEN,
    memoryLimitInMB:                '256',
    awsRequestId:                   'test-request-id',
    logGroupName:                   'log-group',
    logStreamName:                  'log-stream',
    getRemainingTimeInMillis:       () => 30000,
    done:                           () => undefined,
    fail:                           () => undefined,
    succeed:                        () => undefined,
  };
}
