/// <reference types="jest" />

/**
 * Unit and integration tests for advanceUiBucketIfStale.
 *
 * Tests the function's core logic by importing and exercising the REAL function
 * from ../update-ui, with AWS SDK clients mocked via aws-sdk-client-mock.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  CloudFrontClient,
  TagResourceCommand,
} from '@aws-sdk/client-cloudfront';
import { LoggerBuffer } from '../../shared/logger-buffer';
import { advanceUiBucketIfStale } from '../update-ui';

// Mock @serverlessinbox/artifact-registry before importing any handler code.
jest.mock('@serverlessinbox/artifact-registry', () => ({
  deriveTrack: jest.fn(),
  buildArtifactKey: jest.fn(),
  readReleasePointer: jest.fn(),
}), { virtual: true });

// Mock mailbox-cdk-shared content operations.
// update-ui.ts imports from the '/lambda-runtime' subpath export (a distinct module
// specifier from the package's root export), so the mock must target that same subpath
// or Jest loads the real content-ops.ts module — including its module-scope S3Client —
// and issues real AWS calls.
jest.mock('@serverlessinbox/mailbox-cdk-shared/lambda-runtime', () => ({
  deployZipToPrefix: jest.fn(),
  normalizePrefix: jest.fn((prefix) => prefix.endsWith('/') ? prefix : `${prefix}/`),
  invalidateCloudFront: jest.fn(),
}));

// Import mocks as any to work around jest.requireMock's untyped return
const { readReleasePointer, deriveTrack, buildArtifactKey } = jest.requireMock('@serverlessinbox/artifact-registry') as any;
const { deployZipToPrefix, invalidateCloudFront } = jest.requireMock('@serverlessinbox/mailbox-cdk-shared/lambda-runtime') as any;

describe('advanceUiBucketIfStale', () => {
  // aws-sdk-client-mock generic type is awkward (AwsStubbed<CloudFrontClient> loses command specifics);
  // tracking via .commandCalls() is adequate without a full type annotation.
  let cloudFrontMock: any;

  // Get mocked functions from artifact-registry mock
  const mockReadReleasePointer = readReleasePointer as jest.Mock;
  const mockDeriveTrack = deriveTrack as jest.Mock;
  const mockBuildArtifactKey = buildArtifactKey as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DIST_TAG = 'latest';
    process.env.GRANULARITY = 'major';
    process.env.PROJECT = 'serverlessinbox';
    process.env.AWS_REGION = 'us-east-1';
    cloudFrontMock = mockClient(CloudFrontClient as any);
  });

  afterEach(() => {
    cloudFrontMock.restore();
  });

  it('skips when no pointer is available', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue(null);
    const logger = new LoggerBuffer();

    const updated = await advanceUiBucketIfStale(
      'us-east-1',
      'ui-content-bucket',
      'ui-bundle',
      'ui-bundle.zip',
      '1.2.3',
      'arn:aws:cloudfront::818189473156:distribution/ABCD1234',
      logger,
    );

    expect(updated).toBe(false);
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
    const logger = new LoggerBuffer();

    const updated = await advanceUiBucketIfStale(
      'us-east-1',
      'ui-content-bucket',
      'ui-bundle',
      'ui-bundle.zip',
      '1.2.3',
      'arn:aws:cloudfront::818189473156:distribution/ABCD1234',
      logger,
    );

    expect(updated).toBe(false);
    // Pointer version equals deployed, no operations
    expect(deployZipToPrefix).not.toHaveBeenCalled();
  });

  it('updates bucket when stale: deploys, invalidates, and updates distribution tags', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('ui-bundle/release/1.2.4/ui-bundle.zip');
    (deployZipToPrefix as jest.Mock).mockResolvedValue({ uploaded: 42 });
    (invalidateCloudFront as jest.Mock).mockResolvedValue({ invalidated: true });

    cloudFrontMock.on(TagResourceCommand).resolves({});
    const logger = new LoggerBuffer();

    const distributionArn = 'arn:aws:cloudfront::818189473156:distribution/ABCD1234';
    const updated = await advanceUiBucketIfStale(
      'us-east-1',
      'ui-content-bucket',
      'ui-bundle',
      'ui-bundle.zip',
      '1.2.3',
      distributionArn,
      logger,
    );

    expect(updated).toBe(true);
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

    // Verify CloudFront TagResource was called to update distribution tags
    const tagCalls = cloudFrontMock.commandCalls(TagResourceCommand);
    expect(tagCalls).toHaveLength(1);
    // Verify TagResourceCommand was called with correct distribution ARN and artifact-version tag
    expect(tagCalls[0].args[0].input).toEqual({
      Resource: 'arn:aws:cloudfront::818189473156:distribution/ABCD1234',
      Tags: {
        Items: [
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
    const logger = new LoggerBuffer();

    const updated = await advanceUiBucketIfStale(
      'us-east-1',
      'ui-content-bucket',
      'ui-bundle',
      'ui-bundle.zip',
      '1.2.3',
      'arn:aws:cloudfront::818189473156:distribution/ABCD1234',
      logger,
    );

    expect(updated).toBe(false);
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

    cloudFrontMock.on(TagResourceCommand).resolves({});
    const logger = new LoggerBuffer();

    const updated = await advanceUiBucketIfStale(
      'us-east-1',
      'ui-content-bucket',
      'ui-bundle',
      'ui-bundle.zip',
      '1.2.3',
      'arn:aws:cloudfront::818189473156:distribution/ABCD1234',
      logger,
    );

    expect(updated).toBe(true);
    // Verify custom bucket base was used
    expect(deployZipToPrefix).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBucket: 'custom-artifacts-us-east-1',
      }),
    );
  });
});
