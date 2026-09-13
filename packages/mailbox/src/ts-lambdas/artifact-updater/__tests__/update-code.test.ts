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
  GetFunctionConfigurationCommand,
  InvokeCommand,
} from '@aws-sdk/client-lambda';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
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

  const testConfig = {
    distTag: 'latest',
    granularity: 'major',
    project: 'serverlessinbox',
    artifactBucketBase: 'mailbox-artifacts',
  };

  it('skips update when no pointer is available', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue(null);
    const logger = new LoggerBuffer();

    const updated = await advanceLambdaIfStale(
      'us-east-1',
      'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
      'mailbox-go',
      'mailbox-go',
      '1.2.3',
      logger,
      testConfig,
    );

    expect(updated).toBe(false);
    expect(mockDeriveTrack).toHaveBeenCalledWith('1.2.3', 'major');
    expect(mockReadReleasePointer).toHaveBeenCalled();
    // No AWS SDK calls should have been made
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('skips update when version is not newer (idempotent)', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    // Pointer version equals deployed version — no update should occur
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.3',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    const logger = new LoggerBuffer();

    const updated = await advanceLambdaIfStale(
      'us-east-1',
      'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
      'mailbox-go',
      'mailbox-go',
      '1.2.3',
      logger,
      testConfig,
    );

    expect(updated).toBe(false);
    expect(mockDeriveTrack).toHaveBeenCalled();
    expect(mockReadReleasePointer).toHaveBeenCalled();
    // Real semver.gt('1.2.3', '1.2.3') returns false, so no update occurs
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('smoke test pass → updates tag and returns true', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('serverlessinbox/packages/mailbox-go/releases/v1.2.4/lambdas/mailbox-go.zip');

    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Successful',
      FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
    });
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      Payload: JSON.stringify({ serverlessInboxSmokeTestOk: true }) as any,
    });
    lambdaMock.on(TagResourceCommand).resolves({});
    const logger = new LoggerBuffer();

    const updated = await advanceLambdaIfStale(
      'us-east-1',
      'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
      'mailbox-go',
      'mailbox-go',
      '1.2.3',
      logger,
      testConfig,
    );

    expect(updated).toBe(true);
    // Verify UpdateFunctionCodeCommand was called once (no rollback)
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(1);
    // Verify TagResourceCommand was called once with new version
    const tagCalls = lambdaMock.commandCalls(TagResourceCommand);
    expect(tagCalls).toHaveLength(1);
    expect(tagCalls[0].args[0].input.Tags).toEqual({ 'serverless-inbox:artifact-version': '1.2.4' });
  });

  it('smoke test unprobeable → updates tag with warning and returns true', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('serverlessinbox/packages/mailbox-go/releases/v1.2.4/lambdas/mailbox-go.zip');

    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Successful',
      FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
    });
    // Simulate unprobeable: invoke fails with permission denied
    const error = new Error('AccessDenied');
    error.name = 'AccessDenied';
    lambdaMock.on(InvokeCommand).rejects(error);
    lambdaMock.on(TagResourceCommand).resolves({});
    const logger = new LoggerBuffer();

    const updated = await advanceLambdaIfStale(
      'us-east-1',
      'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
      'mailbox-go',
      'mailbox-go',
      '1.2.3',
      logger,
      testConfig,
    );

    expect(updated).toBe(true);
    // Verify UpdateFunctionCodeCommand was called once (no rollback)
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(1);
    // Verify TagResourceCommand was called once (tag still updated despite unprobeable)
    expect(lambdaMock.commandCalls(TagResourceCommand)).toHaveLength(1);
  });

  it('smoke test fail → rolls back and returns false, no tag written', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey
      .mockReturnValueOnce('serverlessinbox/packages/mailbox-go/releases/v1.2.4/lambdas/mailbox-go.zip') // forward update
      .mockReturnValueOnce('serverlessinbox/packages/mailbox-go/releases/v1.2.3/lambdas/mailbox-go.zip'); // rollback

    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Successful',
      FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
    });
    // Simulate probe failure: handler returned false
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      Payload: JSON.stringify({ serverlessInboxSmokeTestOk: false }) as any,
    });
    lambdaMock.on(TagResourceCommand).resolves({});
    const logger = new LoggerBuffer();

    const updated = await advanceLambdaIfStale(
      'us-east-1',
      'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
      'mailbox-go',
      'mailbox-go',
      '1.2.3',
      logger,
      testConfig,
    );

    expect(updated).toBe(false);
    // Verify TWO UpdateFunctionCodeCommand calls: forward + rollback
    const updateCalls = lambdaMock.commandCalls(UpdateFunctionCodeCommand);
    expect(updateCalls).toHaveLength(2);
    // First call should be the new version
    expect(updateCalls[0].args[0].input.S3Key).toContain('v1.2.4');
    // Second call (rollback) should be the old version
    expect(updateCalls[1].args[0].input.S3Key).toContain('v1.2.3');
    // Verify NO TagResourceCommand was called (no tag write on failure)
    expect(lambdaMock.commandCalls(TagResourceCommand)).toHaveLength(0);
  });

  it('settle-wait throws on forward update → no probe and no rollback, error propagates', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('serverlessinbox/packages/mailbox-go/releases/v1.2.4/lambdas/mailbox-go.zip');

    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    // Simulate settle failure: update never completes (times out or fails)
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Failed',
      LastUpdateStatusReason: 'Insufficient permissions',
      FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
    });
    lambdaMock.on(TagResourceCommand).resolves({});
    const logger = new LoggerBuffer();

    await expect(
      advanceLambdaIfStale(
        'us-east-1',
        'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
        'mailbox-go',
        'mailbox-go',
        '1.2.3',
        logger,
        testConfig,
      ),
    ).rejects.toThrow('Function code update failed');

    // Verify ONE UpdateFunctionCodeCommand (forward only, no rollback attempted)
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(1);
    // Verify InvokeCommand was never called (probe not invoked)
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
    // Verify NO TagResourceCommand (no tag write)
    expect(lambdaMock.commandCalls(TagResourceCommand)).toHaveLength(0);
  });

  it('skips target when pointer version is not valid semver', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    // Pointer version is not a valid semver string
    mockReadReleasePointer.mockResolvedValue({
      version: 'not-a-semver',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    const logger = new LoggerBuffer();

    const updated = await advanceLambdaIfStale(
      'us-east-1',
      'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
      'mailbox-go',
      'mailbox-go',
      '1.2.3',
      logger,
      testConfig,
    );

    expect(updated).toBe(false);
    // Should skip without calling UpdateFunctionCodeCommand
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('uses ARTIFACT_BUCKET_BASE env var when provided', async () => {
    process.env.ARTIFACT_BUCKET_BASE = 'custom-artifacts';
    const customConfig = { ...testConfig, artifactBucketBase: 'custom-artifacts' };
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.0.1',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('test-key');

    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Successful',
      FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
    });
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      Payload: JSON.stringify({ serverlessInboxSmokeTestOk: true }) as any,
    });
    lambdaMock.on(TagResourceCommand).resolves({});
    const logger = new LoggerBuffer();

    const updated = await advanceLambdaIfStale('us-east-1', 'arn:aws:lambda:us-east-1:123456789012:function:test', 'test-pkg', 'test-artifact', '1.0.0', logger, customConfig);

    expect(updated).toBe(true);
    // Verify both the readReleasePointer and UpdateFunctionCodeCommand use custom bucket
    expect(mockReadReleasePointer).toHaveBeenCalledWith('test-pkg', 'latest', 'us-east-1', expect.objectContaining({ bucketBase: 'custom-artifacts' }));
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)[0].args[0].input.S3Bucket).toBe('custom-artifacts-us-east-1');
  });
});
