import { S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { Writable } from 'stream';

jest.mock('https', () => ({
  request: jest.fn(),
}));

describe('BucketAutoEmpty handler — smoke test wrapper', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
    jest.clearAllMocks();
  });

  it('responds to smoke test probe without invoking the real handler', async () => {
    const probeEvent = { serverlessInboxSmokeTest: true };
    // eslint-disable-next-line global-require
    const { handler } = require('../handler');
    const result = await handler(probeEvent, {});

    expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
  });
});

describe('BucketAutoEmpty handler — config failure path', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
    jest.clearAllMocks();
  });

  it('smoke test probe reports false when config is bad', async () => {
    jest.resetModules();
    process.env.LOG_LEVEL = 'invalid-log-level';

    // eslint-disable-next-line global-require
    const { handler: badConfigHandler } = require('../handler');

    const probeEvent = { serverlessInboxSmokeTest: true };
    const result = await badConfigHandler(probeEvent, {});

    expect(result).toEqual({ serverlessInboxSmokeTestOk: false });
  });

  async function invokeWithBadConfig(requestType: 'Create' | 'Delete'): Promise<{ body: any; calls: number }> {
    const originalEnv = process.env;

    try {
      // eslint-disable-next-line global-require
      const https = require('https');

      // Capture the request body sent to CloudFormation
      let capturedBody = '';
      https.request.mockImplementation((urlOrOptions: any, optionsOrCallback?: any, callback?: any) => {
        // https.request can be called as request(url, options, callback) or request(options, callback)
        // aws-custom-resources uses the parsed options form
        const actualCallback = callback || optionsOrCallback;

        const mockResponse = {
          statusCode: 200,
        } as any;

        // Invoke callback immediately with the mock response
        if (actualCallback) {
          actualCallback(mockResponse);
        }

        // Return a writable stream that captures the body
        const writeStream = new Writable({
          write(chunk: any, _encoding: string, done: () => void) {
            capturedBody += chunk.toString();
            done();
          },
        });

        return writeStream as any;
      });

      let handlerPromise: any;
      jest.isolateModules(() => {
        process.env = { ...originalEnv, LOG_LEVEL: 'invalid-level' };

        // eslint-disable-next-line global-require
        const mod = require('../handler');

        const event = {
          RequestType: requestType,
          ResponseURL: 'https://example.com/response',
          StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid',
          RequestId: 'unique-id-12345',
          LogicalResourceId: 'TestResource',
          ResourceType: 'Custom::TestResource',
          ResourceProperties: { bucketName: 'test-bucket' },
          PhysicalResourceId: 'physical-id',
        };

        const context = {
          getRemainingTimeInMillis: jest.fn(() => 300000),
          functionName: 'test-function',
          functionVersion: '$LATEST',
          invokeId: 'invoke-id',
          logGroupName: 'log-group',
          logStreamName: 'log-stream',
          memoryLimitInMB: '128',
          awsRequestId: 'request-id',
          identity: {} as any,
          clientContext: undefined as any,
          callbackWaitsForEmptyEventLoop: true,
        };

        handlerPromise = mod.handler(event, context).catch(() => {
          // Ignore errors; we're testing that the response is sent
        });
      });

      // Wait for the handler to complete
      await handlerPromise;
      await new Promise(resolve => setTimeout(resolve, 50));

      // Parse the captured body
      const responseBody = JSON.parse(capturedBody);
      const calls = https.request.mock.calls.length;

      return { body: responseBody, calls };
    } finally {
      process.env = originalEnv;
    }
  }

  it('Create with bad config responds FAILED naming LOG_LEVEL', async () => {
    const { body, calls } = await invokeWithBadConfig('Create');

    expect(calls).toBe(1);
    expect(body.Status).toBe('FAILED');
    expect(body.Reason).toContain('LOG_LEVEL');
  });

  it('Delete with bad config responds SUCCESS so stack deletion is not blocked', async () => {
    const { body, calls } = await invokeWithBadConfig('Delete');

    expect(calls).toBe(1);
    expect(body.Status).toBe('SUCCESS');
  });
});
