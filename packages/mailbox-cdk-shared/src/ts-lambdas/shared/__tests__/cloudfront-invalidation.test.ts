/**
 * Pins when an invalidation is created and what it carries: a request without a distribution or without a
 * non-blank path creates nothing, and a caller reference longer than CloudFront accepts is hashed rather than
 * sent, because CloudFront rejects the request otherwise and the deployment fails.
 */

import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { mockClient }                                  from 'aws-sdk-client-mock';
import type { AwsClientStub }                          from 'aws-sdk-client-mock';

import { invalidateCloudFront }                        from '../cloudfront-invalidation';

describe('invalidateCloudFront', () => {
  let cloudFrontMock: AwsClientStub<CloudFrontClient>;
  let mockClient_: CloudFrontClient;

  beforeEach(() => {
    cloudFrontMock = mockClient(CloudFrontClient);
    mockClient_    = new CloudFrontClient();
  });

  afterEach(() => {
    cloudFrontMock.restore();
  });

  it('sends a CreateInvalidationCommand with correct params', async () => {
    cloudFrontMock.on(CreateInvalidationCommand).resolves({});

    const result = await invalidateCloudFront(mockClient_, {
      distributionId: 'DIST123',
      paths: ['/index.html', '/assets/*'],
      callerReference: 'test-ref-123',
    });

    expect(result).toEqual({ invalidated: true });
    expect(cloudFrontMock.commandCalls(CreateInvalidationCommand)).toHaveLength(1);

    const call = cloudFrontMock.commandCalls(CreateInvalidationCommand)[0];
    expect(call.args[0].input.DistributionId).toBe('DIST123');
    expect(call.args[0].input.InvalidationBatch?.Paths?.Items).toEqual([
      '/index.html',
      '/assets/*',
    ]);
    expect(call.args[0].input.InvalidationBatch?.CallerReference).toBe('test-ref-123');
  });

  it('returns false when distribution ID is empty', async () => {
    const result = await invalidateCloudFront(mockClient_, {
      distributionId: '',
      paths: ['/index.html'],
      callerReference: 'test-ref',
    });

    expect(result).toEqual({ invalidated: false });
    expect(cloudFrontMock.commandCalls(CreateInvalidationCommand)).toHaveLength(0);
  });

  it('returns false when distribution ID is whitespace only', async () => {
    const result = await invalidateCloudFront(mockClient_, {
      distributionId: '   ',
      paths: ['/index.html'],
      callerReference: 'test-ref',
    });

    expect(result).toEqual({ invalidated: false });
    expect(cloudFrontMock.commandCalls(CreateInvalidationCommand)).toHaveLength(0);
  });

  it('returns false when paths array is empty', async () => {
    const result = await invalidateCloudFront(mockClient_, {
      distributionId: 'DIST123',
      paths: [],
      callerReference: 'test-ref',
    });

    expect(result).toEqual({ invalidated: false });
    expect(cloudFrontMock.commandCalls(CreateInvalidationCommand)).toHaveLength(0);
  });

  it('returns false when paths array is undefined', async () => {
    const result = await invalidateCloudFront(mockClient_, {
      distributionId: 'DIST123',
      callerReference: 'test-ref',
    });

    expect(result).toEqual({ invalidated: false });
    expect(cloudFrontMock.commandCalls(CreateInvalidationCommand)).toHaveLength(0);
  });

  it('filters whitespace-only paths from the paths array', async () => {
    cloudFrontMock.on(CreateInvalidationCommand).resolves({});

    const result = await invalidateCloudFront(mockClient_, {
      distributionId: 'DIST123',
      paths: ['/index.html', '   ', '/assets/*', ''],
      callerReference: 'test-ref',
    });

    expect(result).toEqual({ invalidated: true });
    const call = cloudFrontMock.commandCalls(CreateInvalidationCommand)[0];
    expect(call.args[0].input.InvalidationBatch?.Paths?.Items).toEqual([
      '/index.html',
      '/assets/*',
    ]);
  });

  it('hashes caller reference longer than 128 characters', async () => {
    cloudFrontMock.on(CreateInvalidationCommand).resolves({});

    const longRef = 'a'.repeat(200);
    const result  = await invalidateCloudFront(mockClient_, {
      distributionId: 'DIST123',
      paths: ['/*'],
      callerReference: longRef,
    });

    expect(result).toEqual({ invalidated: true });
    const call      = cloudFrontMock.commandCalls(CreateInvalidationCommand)[0];
    const callerRef = call.args[0].input.InvalidationBatch?.CallerReference;
    expect(callerRef).toBeDefined();
    expect(callerRef).not.toBe(longRef);
    expect((callerRef as string).length).toBeLessThanOrEqual(64);
  });

  it('preserves caller reference when 128 characters or less', async () => {
    cloudFrontMock.on(CreateInvalidationCommand).resolves({});

    const ref    = 'a'.repeat(128);
    const result = await invalidateCloudFront(mockClient_, {
      distributionId: 'DIST123',
      paths: ['/*'],
      callerReference: ref,
    });

    expect(result).toEqual({ invalidated: true });
    const call = cloudFrontMock.commandCalls(CreateInvalidationCommand)[0];
    expect(call.args[0].input.InvalidationBatch?.CallerReference).toBe(ref);
  });
});
