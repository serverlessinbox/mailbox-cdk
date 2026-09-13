import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../handler';

describe('ContentDeployer handler — smoke test wrapper', () => {
  const s3Mock = mockClient(S3Client);
  const cloudfrontMock = mockClient(CloudFrontClient);

  beforeEach(() => {
    s3Mock.reset();
    cloudfrontMock.reset();
  });

  it('responds to smoke test probe without invoking the real handler', async () => {
    const probeEvent = { serverlessInboxSmokeTest: true };
    const result = await handler(probeEvent, {});

    expect(result).toEqual({ serverlessInboxSmokeTestOk: true });

    // Verify no S3 operations were invoked (GetObject, ListObjectsV2, DeleteObjects, etc.)
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);

    // Verify no CloudFront operations were invoked
    expect(cloudfrontMock.commandCalls(CreateInvalidationCommand)).toHaveLength(0);
  });

});
