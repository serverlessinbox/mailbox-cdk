/// <reference types="jest" />

/**
 * Unit and integration tests for advanceUiBucketIfStale.
 *
 * Tests the function's core logic by importing and exercising the REAL function
 * from ../update-ui, with AWS SDK clients mocked via aws-sdk-client-mock.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  GetBucketTaggingCommand,
  PutBucketTaggingCommand,
} from '@aws-sdk/client-s3';
import { advanceUiBucketIfStale } from '../update-ui';

// Mock @serverlessinbox/artifact-registry before importing any handler code.
jest.mock('@serverlessinbox/artifact-registry', () => ({
  deriveTrack: jest.fn(),
  buildArtifactKey: jest.fn(),
  readReleasePointer: jest.fn(),
}), { virtual: true });

// Mock shared UI operations
jest.mock('../../shared/ui-ops', () => ({
  deployZipToPrefix: jest.fn(),
  normalizePrefix: jest.fn((prefix) => prefix.endsWith('/') ? prefix : `${prefix}/`),
}));

jest.mock('../../shared/ui-cloudfront', () => ({
  invalidateCloudFront: jest.fn(),
}));

// Import mocks as any to work around unpublished package
const { readReleasePointer, deriveTrack, buildArtifactKey } = jest.requireMock('@serverlessinbox/artifact-registry') as any;
const { deployZipToPrefix } = jest.requireMock('../../shared/ui-ops') as any;
const { invalidateCloudFront } = jest.requireMock('../../shared/ui-cloudfront') as any;

describe('advanceUiBucketIfStale', () => {
  // aws-sdk-client-mock generic type is awkward (AwsStubbed<S3Client> loses command specifics);
  // tracking via .commandCalls() is adequate without a full type annotation.
  let s3Mock: any;

  // Get mocked functions from artifact-registry mock
  const mockReadReleasePointer = readReleasePointer as jest.Mock;
  const mockDeriveTrack = deriveTrack as jest.Mock;
  const mockBuildArtifactKey = buildArtifactKey as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DIST_TAG = 'latest';
    process.env.GRANULARITY = 'major';
    process.env.PROJECT = 'serverlessinbox';
    s3Mock = mockClient(S3Client as any);
  });

  afterEach(() => {
    s3Mock.restore();
  });

  it('skips when no pointer is available', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue(null);

    await advanceUiBucketIfStale(
      'us-east-1',
      'ui-content-bucket',
      'ui-bundle',
      'ui-bundle.zip',
      '1.2.3',
      'ABCD1234',
    );

    expect(mockDeriveTrack).toHaveBeenCalledWith('1.2.3', 'major');
    expect(mockReadReleasePointer).toHaveBeenCalled();
    // No S3 operations should occur
    expect(deployZipToPrefix).not.toHaveBeenCalled();
  });

  it('skips when version is not newer (idempotent)', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.3',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });

    await advanceUiBucketIfStale(
      'us-east-1',
      'ui-content-bucket',
      'ui-bundle',
      'ui-bundle.zip',
      '1.2.3',
      'ABCD1234',
    );

    // Pointer version equals deployed, no operations
    expect(deployZipToPrefix).not.toHaveBeenCalled();
  });

  it('updates bucket when stale: deploys, invalidates, and updates tags', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('ui-bundle/release/1.2.4/ui-bundle.zip');
    (deployZipToPrefix as jest.Mock).mockResolvedValue({ uploaded: 42 });
    (invalidateCloudFront as jest.Mock).mockResolvedValue({ invalidated: true });

    s3Mock.on(GetBucketTaggingCommand).resolves({
      TagSet: [
        { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
        { Key: 'serverless-inbox:auto-update-type', Value: 'ui' },
        { Key: 'serverless-inbox:artifact-package', Value: 'ui-bundle' },
        { Key: 'serverless-inbox:artifact-name', Value: 'ui-bundle.zip' },
        { Key: 'serverless-inbox:artifact-version', Value: '1.2.3' },
        { Key: 'serverless-inbox:distribution-id', Value: 'ABCD1234' },
      ],
    });
    s3Mock.on(PutBucketTaggingCommand).resolves({});

    await advanceUiBucketIfStale(
      'us-east-1',
      'ui-content-bucket',
      'ui-bundle',
      'ui-bundle.zip',
      '1.2.3',
      'ABCD1234',
    );

    // Verify deployZipToPrefix was called
    expect(deployZipToPrefix).toHaveBeenCalledWith({
      sourceBucket: 'mailbox-artifacts-us-east-1',
      sourceKey: 'ui-bundle/release/1.2.4/ui-bundle.zip',
      targetBucket: 'ui-content-bucket',
      targetPrefix: 'content/',
    });

    // Verify invalidateCloudFront was called
    expect(invalidateCloudFront).toHaveBeenCalledWith({
      distributionId: 'ABCD1234',
      paths: ['/*'],
      callerReference: expect.stringContaining('ui-update:ui-content-bucket:1.2.4'),
    });

    // Verify GetBucketTagging and PutBucketTagging were called with correct merged tag set
    const getTags = s3Mock.commandCalls(GetBucketTaggingCommand);
    expect(getTags).toHaveLength(1);

    const putTags = s3Mock.commandCalls(PutBucketTaggingCommand);
    expect(putTags).toHaveLength(1);
    // Verify PutBucketTaggingCommand was called with full merged tag set: existing tags preserved, only artifact-version bumped
    expect(putTags[0].args[0].input).toEqual({
      Bucket: 'ui-content-bucket',
      Tagging: {
        TagSet: [
          { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
          { Key: 'serverless-inbox:auto-update-type', Value: 'ui' },
          { Key: 'serverless-inbox:artifact-package', Value: 'ui-bundle' },
          { Key: 'serverless-inbox:artifact-name', Value: 'ui-bundle.zip' },
          { Key: 'serverless-inbox:distribution-id', Value: 'ABCD1234' },
          { Key: 'serverless-inbox:artifact-version', Value: '1.2.4' },
        ],
      },
    });
  });

  it('skips when version is not valid semver', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: 'not-a-version',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });

    await advanceUiBucketIfStale(
      'us-east-1',
      'ui-content-bucket',
      'ui-bundle',
      'ui-bundle.zip',
      '1.2.3',
      'ABCD1234',
    );

    // Should skip entirely
    expect(deployZipToPrefix).not.toHaveBeenCalled();
  });

  it('uses custom ARTIFACT_BUCKET_BASE when provided', async () => {
    process.env.ARTIFACT_BUCKET_BASE = 'custom-artifacts';
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('ui-bundle/release/1.2.4/ui-bundle.zip');
    (deployZipToPrefix as jest.Mock).mockResolvedValue({ uploaded: 10 });
    (invalidateCloudFront as jest.Mock).mockResolvedValue({ invalidated: true });

    s3Mock.on(GetBucketTaggingCommand).resolves({ TagSet: [] });
    s3Mock.on(PutBucketTaggingCommand).resolves({});

    await advanceUiBucketIfStale(
      'us-east-1',
      'ui-content-bucket',
      'ui-bundle',
      'ui-bundle.zip',
      '1.2.3',
      'ABCD1234',
    );

    // Verify custom bucket base was used
    expect(deployZipToPrefix).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBucket: 'custom-artifacts-us-east-1',
      }),
    );
  });
});
