import type { handler } from '../handler';

type HandlerContext = Parameters<typeof handler>[1];

/**
 * Fixtures for the stack-helpers handler tests. `wrapHandler` reads `getRemainingTimeInMillis` from
 * the Lambda context and sends its answer to the event's `ResponseURL`.
 */
export function fakeLambdaContext(): HandlerContext {
  return {
    getRemainingTimeInMillis: () => 300000,
    functionName: 'test-function',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '256',
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

export interface FakeDeleteEvent extends FakeCfnEventBase {
  RequestType: 'Delete';
  PhysicalResourceId: string;
}

export type FakeCfnEvent = FakeCreateEvent | FakeDeleteEvent;

function fakeCfnEventBase(resourceProperties: Record<string, unknown>): FakeCfnEventBase {
  const serviceToken = 'arn:aws:lambda:us-east-1:123456789012:function:stack-helpers';
  return {
    ResponseURL: 'https://example.com/response',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid',
    RequestId: 'request-123',
    LogicalResourceId: 'StackHelpersResource',
    ResourceType: 'Custom::StackHelpers',
    ServiceToken: serviceToken,
    ResourceProperties: { ...resourceProperties, ServiceToken: serviceToken },
  };
}

export function fakeCreateEvent(resourceProperties: Record<string, unknown>): FakeCreateEvent {
  return { ...fakeCfnEventBase(resourceProperties), RequestType: 'Create' };
}

export function fakeDeleteEvent(resourceProperties: Record<string, unknown>): FakeDeleteEvent {
  return { ...fakeCfnEventBase(resourceProperties), RequestType: 'Delete', PhysicalResourceId: 'physical-id' };
}
