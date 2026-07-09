/// <reference types="jest" />

/**
 * Unit and integration tests for advanceLambdaIfStale.
 *
 * Tests the function's core logic by importing and exercising the REAL function
 * from ../update-code, with AWS SDK clients mocked via aws-sdk-client-mock.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  LambdaClient,
  UpdateFunctionCodeCommand,
  TagResourceCommand,
} from '@aws-sdk/client-lambda';
import { advanceLambdaIfStale } from '../update-code';

// Mock @serverlessinbox/artifact-registry before importing any handler code.
// Note: artifact-registry is not yet published (pending), so this mock allows
// the test file to compile even if the actual package isn't available yet.
jest.mock('@serverlessinbox/artifact-registry', () => ({
  deriveTrack: jest.fn(),
  buildArtifactKey: jest.fn(),
  readReleasePointer: jest.fn(),
}), { virtual: true });

// Import mocks as any to work around unpublished package
const { readReleasePointer, deriveTrack, buildArtifactKey } = jest.requireMock('@serverlessinbox/artifact-registry') as any;

describe('advanceLambdaIfStale', () => {
  const lambdaMock = mockClient(LambdaClient);

  // Get mocked functions from artifact-registry mock
  const mockReadReleasePointer = readReleasePointer as jest.Mock;
  const mockDeriveTrack = deriveTrack as jest.Mock;
  const mockBuildArtifactKey = buildArtifactKey as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    lambdaMock.reset();
    // Reset environment variables
    delete process.env.DIST_TAG;
    delete process.env.GRANULARITY;
    delete process.env.PROJECT;
    delete process.env.ARTIFACT_BUCKET_BASE;
    delete process.env.AWS_REGION;
  });

  beforeEach(() => {
    process.env.DIST_TAG = 'latest';
    process.env.GRANULARITY = 'major';
    process.env.PROJECT = 'serverlessinbox';
  });

  it('skips update when no pointer is available', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue(null);

    await advanceLambdaIfStale(
      'us-east-1',
      'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
      'mailbox-go',
      'mailbox-go',
      '1.2.3',
    );

    expect(mockDeriveTrack).toHaveBeenCalledWith('1.2.3', 'major');
    expect(mockReadReleasePointer).toHaveBeenCalled();
    // No AWS SDK calls should have been made
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);
  });

  it('skips update when version is not newer (idempotent)', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    // Pointer version equals deployed version — no update should occur
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.3',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });

    await advanceLambdaIfStale(
      'us-east-1',
      'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
      'mailbox-go',
      'mailbox-go',
      '1.2.3',
    );

    expect(mockDeriveTrack).toHaveBeenCalled();
    expect(mockReadReleasePointer).toHaveBeenCalled();
    // Real semver.gt('1.2.3', '1.2.3') returns false, so no update occurs
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);
  });

  it('advances Lambda when pointer version is strictly newer (uses default bucketBase)', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    // Pointer version (1.2.4) is strictly newer than deployed version (1.2.3)
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('serverlessinbox/packages/mailbox-go/releases/v1.2.4/lambdas/mailbox-go.zip');

    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(TagResourceCommand).resolves({});

    await advanceLambdaIfStale(
      'us-east-1',
      'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
      'mailbox-go',
      'mailbox-go',
      '1.2.3',
    );

    // Verify readReleasePointer was called with default bucketBase
    expect(mockReadReleasePointer).toHaveBeenCalledWith(
      'mailbox-go',
      'latest',
      'us-east-1',
      expect.objectContaining({
        bucketBase: 'mailbox-artifacts',
        project: 'serverlessinbox',
      }),
    );

    // Verify UpdateFunctionCodeCommand used the default bucket
    const updateCalls = lambdaMock.commandCalls(UpdateFunctionCodeCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input.S3Bucket).toBe('mailbox-artifacts-us-east-1');

    // Verify TagResourceCommand was called with new version
    const tagCalls = lambdaMock.commandCalls(TagResourceCommand);
    expect(tagCalls).toHaveLength(1);
    expect(tagCalls[0].args[0].input.Tags).toEqual({ 'serverless-inbox:artifact-version': '1.2.4' });
  });

  it('skips target when pointer version is not valid semver', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    // Pointer version is not a valid semver string
    mockReadReleasePointer.mockResolvedValue({
      version: 'not-a-semver',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });

    await advanceLambdaIfStale(
      'us-east-1',
      'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
      'mailbox-go',
      'mailbox-go',
      '1.2.3',
    );

    // Should skip without calling UpdateFunctionCodeCommand
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);
  });

  it('uses ARTIFACT_BUCKET_BASE env var when provided', async () => {
    process.env.ARTIFACT_BUCKET_BASE = 'custom-artifacts';
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.0.1',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('test-key');

    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(TagResourceCommand).resolves({});

    await advanceLambdaIfStale('us-east-1', 'arn:aws:lambda:us-east-1:123456789012:function:test', 'test-pkg', 'test-artifact', '1.0.0');

    // Verify both the readReleasePointer and UpdateFunctionCodeCommand use custom bucket
    expect(mockReadReleasePointer).toHaveBeenCalledWith('test-pkg', 'latest', 'us-east-1', expect.objectContaining({ bucketBase: 'custom-artifacts' }));
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)[0].args[0].input.S3Bucket).toBe('custom-artifacts-us-east-1');
  });
});
