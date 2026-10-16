import type { handler } from '../handler';

export type HandlerContext = Parameters<typeof handler>[1];

export const STACK_ID = 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid';
export const LOGICAL_RESOURCE_ID = 'TestResource';
export const REQUEST_ID = 'request-123';
export const PHYSICAL_RESOURCE_ID = `content-assets:${STACK_ID}:${LOGICAL_RESOURCE_ID}`;

/**
 * The Lambda context the handler tests pass in. `wrapHandler` reads `getRemainingTimeInMillis` from it
 * and builds the CloudWatch link of a FAILED response from the log group and stream.
 */
export function fakeLambdaContext(remainingTimeMs: number = 300000): NonNullable<HandlerContext> {
  return {
    getRemainingTimeInMillis: () => remainingTimeMs,
    functionName: 'test-function',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '1024',
    awsRequestId: 'request-id',
    logGroupName: 'log-group',
    logStreamName: 'log-stream',
    callbackWaitsForEmptyEventLoop: true,
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
  };
}

interface FakeCfnEventBase {
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  ResourceType: string;
  ServiceToken: string;
  ResourceProperties: Record<string, unknown> & { ServiceToken: string };
}

export interface FakeCreateEvent extends FakeCfnEventBase {
  RequestType: 'Create';
}

export interface FakeUpdateEvent extends FakeCfnEventBase {
  RequestType: 'Update';
  PhysicalResourceId: string;
  OldResourceProperties: Record<string, unknown> & { ServiceToken: string };
}

export interface FakeDeleteEvent extends FakeCfnEventBase {
  RequestType: 'Delete';
  PhysicalResourceId: string;
}

export type FakeCfnEvent = FakeCreateEvent | FakeUpdateEvent | FakeDeleteEvent;

function fakeCfnEventBase(resourceProperties: Record<string, unknown>): FakeCfnEventBase {
  const serviceToken = 'arn:aws:lambda:us-east-1:123456789012:function:content-deployer';
  return {
    ResponseURL: 'https://example.com/response',
    StackId: STACK_ID,
    RequestId: REQUEST_ID,
    LogicalResourceId: LOGICAL_RESOURCE_ID,
    ResourceType: 'Custom::ContentDeployment',
    ServiceToken: serviceToken,
    ResourceProperties: { ...resourceProperties, ServiceToken: serviceToken },
  };
}

export function fakeCreateEvent(resourceProperties: Record<string, unknown>): FakeCreateEvent {
  return { ...fakeCfnEventBase(resourceProperties), RequestType: 'Create' };
}

export function fakeUpdateEvent(resourceProperties: Record<string, unknown>): FakeUpdateEvent {
  const base = fakeCfnEventBase(resourceProperties);
  return {
    ...base,
    RequestType: 'Update',
    PhysicalResourceId: PHYSICAL_RESOURCE_ID,
    OldResourceProperties: base.ResourceProperties,
  };
}

export function fakeDeleteEvent(resourceProperties: Record<string, unknown>): FakeDeleteEvent {
  return { ...fakeCfnEventBase(resourceProperties), RequestType: 'Delete', PhysicalResourceId: PHYSICAL_RESOURCE_ID };
}

export function dataSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'data', key: 'config/config.json', body: '{"a":1}', ...overrides };
}

export function zipSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'zip',
    sourceBucket: 'artifacts-bucket',
    sourceKey: 'bundle.zip',
    targetPrefix: 'content/',
    ...overrides,
  };
}
