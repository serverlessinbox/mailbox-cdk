import { S3Client, ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../handler';

describe('BucketAutoEmpty handler — smoke test wrapper', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
  });

  it('responds to smoke test probe without invoking the real handler', async () => {
    const probeEvent = { serverlessInboxSmokeTest: true };
    const result = await handler(probeEvent, {});

    expect(result).toEqual({ serverlessInboxSmokeTestOk: true });

    // Verify no S3 operations were invoked (ListObjectVersions, DeleteObjects, etc.)
    expect(s3Mock.commandCalls(ListObjectVersionsCommand)).toHaveLength(0);
  });
});
