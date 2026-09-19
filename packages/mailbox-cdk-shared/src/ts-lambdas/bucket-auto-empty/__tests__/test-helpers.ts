/**
 * Shared fixtures for bucket-auto-empty handler tests.
 *
 * A fake Lambda context must expose `getRemainingTimeInMillis` (used by
 * `wrapHandler`'s timeout guard) plus `logStreamName`/`logGroupName` (used to build
 * the CloudWatch link on a FAILED response) — see `aws-custom-resources`' handler.
 */
export interface FakeLambdaContext {
  getRemainingTimeInMillis: () => number;
  functionName: string;
  functionVersion: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  callbackWaitsForEmptyEventLoop: boolean;
}

export function fakeLambdaContext(overrides: Partial<FakeLambdaContext> = {}): FakeLambdaContext {
  return {
    getRemainingTimeInMillis: () => 300000,
    functionName: 'test-function',
    functionVersion: '$LATEST',
    memoryLimitInMB: '128',
    awsRequestId: 'request-id',
    logGroupName: 'log-group',
    logStreamName: 'log-stream',
    callbackWaitsForEmptyEventLoop: true,
    ...overrides,
  };
}

export interface FakeCfnEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  ResourceType: string;
  ResourceProperties: Record<string, unknown>;
  PhysicalResourceId?: string;
}

export function fakeCfnEvent(overrides: Partial<FakeCfnEvent> = {}): FakeCfnEvent {
  return {
    RequestType: 'Update',
    ResponseURL: 'https://example.com/response',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid',
    RequestId: 'request-123',
    LogicalResourceId: 'TestResource',
    ResourceType: 'Custom::BucketAutoEmpty',
    ResourceProperties: { bucketName: 'test-bucket' },
    PhysicalResourceId: 'bucket-auto-empty:arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid:TestResource',
    ...overrides,
  };
}
