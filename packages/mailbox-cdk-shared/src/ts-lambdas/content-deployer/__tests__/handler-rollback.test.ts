import { mockClient } from 'aws-sdk-client-mock';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { S3Client } from '@aws-sdk/client-s3';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { Writable } from 'stream';
import { fakeLambdaContext, fakeCfnEvent } from './test-helpers';

jest.mock('https', () => ({
  request: jest.fn(),
}));

describe('content-deployer handler — rollback behavior', () => {
  const cfnMock = mockClient(CloudFormationClient);
  // Registered so the real handler's module-level `new S3Client()` / `new CloudFrontClient()`
  // never make a real network call if a case ever reaches past property validation.
  const s3Mock = mockClient(S3Client);
  const cloudfrontMock = mockClient(CloudFrontClient);

  beforeEach(() => {
    cfnMock.reset();
    s3Mock.reset();
    cloudfrontMock.reset();
    jest.clearAllMocks();
  });

  /**
   * Invokes the real handler and returns the parsed CFN response body it PUTs
   * to ResponseURL, captured from the mocked `https.request` write stream.
   */
  async function invokeAndCaptureResponse(event: ReturnType<typeof fakeCfnEvent>): Promise<any> {
    // eslint-disable-next-line global-require
    const https = require('https');
    let capturedBody = '';
    https.request.mockImplementation((_options: any, callback: any) => {
      const mockResponse = { statusCode: 200 } as any;
      if (callback) callback(mockResponse);
      return new Writable({
        write(chunk: any, _encoding: string, done: () => void) {
          capturedBody += chunk.toString();
          done();
        },
      }) as any;
    });

    // eslint-disable-next-line global-require
    const { handler } = require('../handler');
    await handler(event, fakeLambdaContext());

    return JSON.parse(capturedBody);
  }

  describe('on Update with side-effect failure and parent rolling back', () => {
    it('returns SUCCESS with the unchanged PhysicalResourceId', async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [{ StackStatus: 'UPDATE_ROLLBACK_IN_PROGRESS' }],
      });

      const event = fakeCfnEvent({
        RequestType: 'Update',
        // A malformed `sources` array fails ResourceProperties validation, driving
        // the handler into the rollback-suppression branch under test without any
        // real S3/CloudFront work.
        ResourceProperties: { targetBucket: 'test-bucket', sources: 'not-an-array' as unknown as [] },
      });

      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('SUCCESS');
      expect(response.PhysicalResourceId).toBe(event.PhysicalResourceId);
    });
  });

  describe('on Update with side-effect failure and parent not rolling back', () => {
    it('returns FAILED when parent is UPDATE_IN_PROGRESS', async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [{ StackStatus: 'UPDATE_IN_PROGRESS' }],
      });

      const event = fakeCfnEvent({
        RequestType: 'Update',
        ResourceProperties: { targetBucket: 'test-bucket', sources: 'not-an-array' as unknown as [] },
      });

      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('FAILED');
      expect(response.PhysicalResourceId).toBe(event.PhysicalResourceId);
    });
  });

  describe('on Update with side-effect failure and DescribeStacks error', () => {
    it('treats as not rolling back and returns FAILED', async () => {
      cfnMock.on(DescribeStacksCommand).rejects(new Error('Stack not found'));

      const event = fakeCfnEvent({
        RequestType: 'Update',
        ResourceProperties: { targetBucket: 'test-bucket', sources: 'not-an-array' as unknown as [] },
      });

      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('FAILED');
      expect(response.PhysicalResourceId).toBe(event.PhysicalResourceId);
    });
  });

  describe('on Create with side-effect failure and parent rolling back', () => {
    it('returns FAILED — rollback suppression only applies to Update', async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [{ StackStatus: 'UPDATE_ROLLBACK_IN_PROGRESS' }],
      });

      const event = fakeCfnEvent({
        RequestType: 'Create',
        PhysicalResourceId: undefined,
        ResourceProperties: { targetBucket: 'test-bucket', sources: 'not-an-array' as unknown as [] },
      });

      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('FAILED');
      // DescribeStacks must never even be consulted for a Create failure.
      expect(cfnMock.calls()).toHaveLength(0);
    });
  });
});
