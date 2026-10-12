import { mockClient } from 'aws-sdk-client-mock';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import type { Stack, StackStatus } from '@aws-sdk/client-cloudformation';
import { Writable } from 'stream';
import { fakeLambdaContext, fakeCfnEvent } from './test-helpers';

jest.mock('https', () => ({
  request: jest.fn(),
}));

process.env['SERVICE_NAME'] = 'bucket-auto-empty';

function parentStackInStatus(stackStatus: StackStatus): Stack {
  return { StackName: 'parent-stack', CreationTime: new Date(), StackStatus: stackStatus };
}

describe('bucket-auto-empty handler — rollback behavior', () => {
  const cfnMock = mockClient(CloudFormationClient);

  beforeEach(() => {
    cfnMock.reset();
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

  describe('on Update with failure and parent rolling back', () => {
    it('returns SUCCESS with the unchanged PhysicalResourceId when parent is UPDATE_ROLLBACK_IN_PROGRESS', async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [parentStackInStatus('UPDATE_ROLLBACK_IN_PROGRESS')],
      });

      const event = fakeCfnEvent({
        RequestType: 'Update',
        // Invalid bucketName (non-string) forces the handler's validation to throw,
        // driving it into the rollback-suppression branch under test.
        ResourceProperties: { bucketName: 123 as unknown as string },
      });

      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('SUCCESS');
      expect(response.PhysicalResourceId).toBe(event.PhysicalResourceId);
    });
  });

  describe('on Update with failure and parent NOT rolling back', () => {
    it('returns FAILED when parent is UPDATE_IN_PROGRESS', async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [parentStackInStatus('UPDATE_IN_PROGRESS')],
      });

      const event = fakeCfnEvent({
        RequestType: 'Update',
        ResourceProperties: { bucketName: 123 as unknown as string },
      });

      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('FAILED');
      expect(response.PhysicalResourceId).toBe(event.PhysicalResourceId);
    });
  });

  describe('on Update with failure and DescribeStacks error', () => {
    it('treats as not rolling back and returns FAILED', async () => {
      cfnMock.on(DescribeStacksCommand).rejects(new Error('Stack not found'));

      const event = fakeCfnEvent({
        RequestType: 'Update',
        ResourceProperties: { bucketName: 123 as unknown as string },
      });

      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('FAILED');
      expect(response.PhysicalResourceId).toBe(event.PhysicalResourceId);
    });
  });

  describe('on Create with failure and parent rolling back', () => {
    it('returns FAILED — rollback suppression only applies to Update', async () => {
      cfnMock.on(DescribeStacksCommand).resolves({
        Stacks: [parentStackInStatus('UPDATE_ROLLBACK_IN_PROGRESS')],
      });

      const event = fakeCfnEvent({
        RequestType: 'Create',
        PhysicalResourceId: undefined,
        ResourceProperties: { bucketName: 123 as unknown as string },
      });

      const response = await invokeAndCaptureResponse(event);

      expect(response.Status).toBe('FAILED');
      // DescribeStacks must never even be consulted for a Create failure.
      expect(cfnMock.calls()).toHaveLength(0);
    });
  });
});
