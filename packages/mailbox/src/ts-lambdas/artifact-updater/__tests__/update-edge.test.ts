/// <reference types="jest" />

/**
 * Unit and integration tests for advanceEdgeLambdaIfStale.
 *
 * Tests the function's core logic by importing and exercising the REAL function
 * from ../update-edge, with AWS SDK clients mocked via aws-sdk-client-mock.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  LambdaClient,
  UpdateFunctionCodeCommand,
  TagResourceCommand,
  PublishVersionCommand,
  GetFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';
import {
  CloudFrontClient,
  ListDistributionsCommand,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
} from '@aws-sdk/client-cloudfront';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { advanceEdgeLambdaIfStale } from '../update-edge';

// Mock @serverlessinbox/artifact-registry before importing any handler code.
jest.mock('@serverlessinbox/artifact-registry', () => ({
  deriveTrack: jest.fn(),
  buildArtifactKey: jest.fn(),
  readReleasePointer: jest.fn(),
}), { virtual: true });

// Import mocks as any to work around unpublished package
const { readReleasePointer, deriveTrack, buildArtifactKey } = jest.requireMock('@serverlessinbox/artifact-registry') as any;

// Fixture helpers to reduce boilerplate
function createDistributionWithEdgeLambda(
  distId: string,
  lambdaArn: string,
  lambdaVersion: string,
): any {
  return {
    Id: distId,
    DomainName: `${distId}.cloudfront.net`,
    DefaultCacheBehavior: {
      TargetOriginId: 'myOrigin',
      ViewerProtocolPolicy: 'allow-all',
      TrustedSigners: { Enabled: false, Quantity: 0 },
      ForwardedValues: { QueryString: false, Cookies: { Forward: 'none' } },
      LambdaFunctionAssociations: {
        Quantity: 1,
        Items: [
          {
            EventType: 'origin-request',
            LambdaFunctionARN: `${lambdaArn}:${lambdaVersion}`,
          },
        ],
      },
    },
    ETag: 'test-etag',
  };
}

function createDistributionConfig(lambdaArn: string, lambdaVersion: string, additionalBehaviorWithLambda?: boolean): any {
  const config: any = {
    CallerReference: 'test-ref',
    Comment: 'test-distribution',
    Enabled: true,
    Origins: {
      Quantity: 1,
      Items: [{ Id: 'myOrigin', DomainName: 'example.com', CustomOriginConfig: { HTTPPort: 80, OriginProtocolPolicy: 'http-only' } }],
    },
    DefaultCacheBehavior: {
      TargetOriginId: 'myOrigin',
      ViewerProtocolPolicy: 'allow-all',
      TrustedSigners: { Enabled: false, Quantity: 0 },
      ForwardedValues: { QueryString: false, Cookies: { Forward: 'none' } },
      LambdaFunctionAssociations: {
        Quantity: 1,
        Items: [
          {
            EventType: 'origin-request',
            LambdaFunctionARN: `${lambdaArn}:${lambdaVersion}`,
          },
        ],
      },
    },
  };

  if (additionalBehaviorWithLambda) {
    config.CacheBehaviors = {
      Quantity: 1,
      Items: [
        {
          PathPattern: '/api/*',
          TargetOriginId: 'myOrigin',
          ViewerProtocolPolicy: 'allow-all',
          TrustedSigners: { Enabled: false, Quantity: 0 },
          ForwardedValues: { QueryString: false, Cookies: { Forward: 'none' } },
          LambdaFunctionAssociations: {
            Quantity: 1,
            Items: [
              {
                EventType: 'viewer-request',
                LambdaFunctionARN: `${lambdaArn}:${lambdaVersion}`,
              },
            ],
          },
        },
      ],
    };
  }

  return config;
}

describe('advanceEdgeLambdaIfStale', () => {
  const lambdaMock = mockClient(LambdaClient);
  const cloudFrontMock = mockClient(CloudFrontClient);

  // Get mocked functions from artifact-registry mock
  const mockReadReleasePointer = readReleasePointer as jest.Mock;
  const mockDeriveTrack = deriveTrack as jest.Mock;
  const mockBuildArtifactKey = buildArtifactKey as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    lambdaMock.reset();
    cloudFrontMock.reset();
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

  it('skips when no pointer is available', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue(null);
    const logger = new LoggerBuffer();

    const updated = await advanceEdgeLambdaIfStale(
      'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda',
      'edge-pkg',
      'edge-lambda',
      '1.2.3',
      logger,
      testConfig,
    );

    expect(updated).toBe(false);
    expect(mockDeriveTrack).toHaveBeenCalledWith('1.2.3', 'major');
    expect(mockReadReleasePointer).toHaveBeenCalled();
    // No update commands should occur
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(PublishVersionCommand)).toHaveLength(0);
  });

  it('skips when version is not newer', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.3',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    const logger = new LoggerBuffer();

    const updated = await advanceEdgeLambdaIfStale(
      'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda',
      'edge-pkg',
      'edge-lambda',
      '1.2.3',
      logger,
      testConfig,
    );

    expect(updated).toBe(false);
    // No update commands
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);
  });

  it('skips when version is not valid semver', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: 'invalid',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    const logger = new LoggerBuffer();

    const updated = await advanceEdgeLambdaIfStale(
      'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda',
      'edge-pkg',
      'edge-lambda',
      '1.2.3',
      logger,
      testConfig,
    );

    expect(updated).toBe(false);
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);
  });

  it('updates edge lambda, publishes version, repoints CloudFront, and tags when stale', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('edge-pkg/release/1.2.4/lambdas/edge-lambda.zip');

    const edgeLambdaArn = 'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda';
    const newVersionArn = 'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda:5';

    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Successful',
    });
    lambdaMock.on(PublishVersionCommand).resolves({
      FunctionArn: newVersionArn,
    });

    // Mock CloudFront ListDistributions to find the associated distribution
    // Give it a different ETag than GetDistributionConfig so we can verify the correct one is used
    const distribution = createDistributionWithEdgeLambda('DIST123', edgeLambdaArn, '3');
    distribution.ETag = 'list-etag-wrong';
    cloudFrontMock.on(ListDistributionsCommand).resolves({
      DistributionList: {
        IsTruncated: false,
        Items: [distribution],
        Marker: '',
        MaxItems: 100,
        Quantity: 1,
      },
    });

    // Mock GetDistributionConfig with different (correct) ETag
    const distConfig = createDistributionConfig(edgeLambdaArn, '3');
    const correctETag = 'config-etag-correct';
    cloudFrontMock.on(GetDistributionConfigCommand).resolves({
      DistributionConfig: distConfig,
      ETag: correctETag,
    });

    cloudFrontMock.on(UpdateDistributionCommand).resolves({});
    lambdaMock.on(TagResourceCommand).resolves({});
    const logger = new LoggerBuffer();

    const updated = await advanceEdgeLambdaIfStale(
      edgeLambdaArn,
      'edge-pkg',
      'edge-lambda',
      '1.2.3',
      logger,
      testConfig,
    );

    expect(updated).toBe(true);
    // Verify UpdateFunctionCode was called
    const updateCalls = lambdaMock.commandCalls(UpdateFunctionCodeCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input.S3Bucket).toBe('mailbox-artifacts-us-east-1');

    // Verify PublishVersion was called
    const publishCalls = lambdaMock.commandCalls(PublishVersionCommand);
    expect(publishCalls).toHaveLength(1);

    // Verify ListDistributions was called
    expect(cloudFrontMock.commandCalls(ListDistributionsCommand)).toHaveLength(1);

    // Verify GetDistributionConfig was called
    expect(cloudFrontMock.commandCalls(GetDistributionConfigCommand)).toHaveLength(1);

    // Verify UpdateDistribution was called with CORRECT ETag from GetDistributionConfig, not ListDistributions
    const updateDistCalls = cloudFrontMock.commandCalls(UpdateDistributionCommand);
    expect(updateDistCalls).toHaveLength(1);
    expect(updateDistCalls[0].args[0].input.Id).toBe('DIST123');
    expect(updateDistCalls[0].args[0].input.IfMatch).toBe(correctETag);

    // Verify the distribution config was updated with new version ARN
    const updatedDistConfig = updateDistCalls[0].args[0].input.DistributionConfig;
    const updatedArn = updatedDistConfig?.DefaultCacheBehavior?.LambdaFunctionAssociations?.Items?.[0]?.LambdaFunctionARN;
    expect(updatedArn).toBe(newVersionArn);

    // Verify TagResource was called
    const tagCalls = lambdaMock.commandCalls(TagResourceCommand);
    expect(tagCalls).toHaveLength(1);
    expect(tagCalls[0].args[0].input.Tags).toEqual({ 'serverless-inbox:artifact-version': '1.2.4' });
  });

  it('repoints edge lambda on non-default cache behavior and non-origin-request event type', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('edge-pkg/release/1.2.4/lambdas/edge-lambda.zip');

    const edgeLambdaArn = 'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda';
    const newVersionArn = 'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda:5';

    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Successful',
    });
    lambdaMock.on(PublishVersionCommand).resolves({
      FunctionArn: newVersionArn,
    });

    // Create distribution with lambda on a non-default cache behavior with non-origin-request event type
    const distribution: any = {
      Id: 'DIST456',
      DomainName: 'dist456.cloudfront.net',
      DefaultCacheBehavior: {
        TargetOriginId: 'myOrigin',
        ViewerProtocolPolicy: 'allow-all',
        TrustedSigners: { Enabled: false, Quantity: 0 },
        ForwardedValues: { QueryString: false, Cookies: { Forward: 'none' } },
        LambdaFunctionAssociations: { Quantity: 0, Items: [] },
      },
      CacheBehaviors: {
        Quantity: 1,
        Items: [
          {
            PathPattern: '/api/*',
            TargetOriginId: 'myOrigin',
            ViewerProtocolPolicy: 'allow-all',
            TrustedSigners: { Enabled: false, Quantity: 0 },
            ForwardedValues: { QueryString: false, Cookies: { Forward: 'none' } },
            LambdaFunctionAssociations: {
              Quantity: 1,
              Items: [
                {
                  EventType: 'viewer-request',
                  LambdaFunctionARN: `${edgeLambdaArn}:3`,
                },
              ],
            },
          },
        ],
      },
      ETag: 'list-etag',
    };

    cloudFrontMock.on(ListDistributionsCommand).resolves({
      DistributionList: {
        IsTruncated: false,
        Items: [distribution],
        Marker: '',
        MaxItems: 100,
        Quantity: 1,
      },
    });

    const distConfig = createDistributionConfig(edgeLambdaArn, '3', true);
    const correctETag = 'config-etag-correct-behavior';
    cloudFrontMock.on(GetDistributionConfigCommand).resolves({
      DistributionConfig: distConfig,
      ETag: correctETag,
    });

    cloudFrontMock.on(UpdateDistributionCommand).resolves({});
    lambdaMock.on(TagResourceCommand).resolves({});
    const logger = new LoggerBuffer();

    const updated = await advanceEdgeLambdaIfStale(
      edgeLambdaArn,
      'edge-pkg',
      'edge-lambda',
      '1.2.3',
      logger,
      testConfig,
    );

    expect(updated).toBe(true);
    // Verify UpdateDistribution was called with correct ETag
    const updateDistCalls = cloudFrontMock.commandCalls(UpdateDistributionCommand);
    expect(updateDistCalls).toHaveLength(1);
    expect(updateDistCalls[0].args[0].input.IfMatch).toBe(correctETag);

    // Verify the non-default cache behavior association was updated
    const updatedDistConfig = updateDistCalls[0].args[0].input.DistributionConfig;
    const cacheBehaviors = updatedDistConfig?.CacheBehaviors?.Items;
    expect(cacheBehaviors).toBeDefined();
    expect(cacheBehaviors![0].LambdaFunctionAssociations?.Items![0].LambdaFunctionARN).toBe(newVersionArn);

    // Verify TagResource was called
    const tagCalls = lambdaMock.commandCalls(TagResourceCommand);
    expect(tagCalls).toHaveLength(1);
    expect(tagCalls[0].args[0].input.Tags).toEqual({ 'serverless-inbox:artifact-version': '1.2.4' });
  });

  it('throws error when distribution is not found', async () => {
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('edge-pkg/release/1.2.4/lambdas/edge-lambda.zip');

    const edgeLambdaArn = 'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda';

    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Successful',
    });
    lambdaMock.on(PublishVersionCommand).resolves({
      FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda:5',
    });

    // No matching distribution
    const otherDist = createDistributionWithEdgeLambda('DIST_OTHER', 'arn:aws:lambda:us-east-1:123456789012:function:other-lambda', '1');
    cloudFrontMock.on(ListDistributionsCommand).resolves({
      DistributionList: {
        IsTruncated: false,
        Items: [otherDist],
        Marker: '',
        MaxItems: 100,
        Quantity: 1,
      },
    });
    const logger = new LoggerBuffer();

    await expect(
      advanceEdgeLambdaIfStale(
        edgeLambdaArn,
        'edge-pkg',
        'edge-lambda',
        '1.2.3',
        logger,
        testConfig,
      ),
    ).rejects.toThrow(`No CloudFront distribution found for edge lambda ${edgeLambdaArn}`);
  });

  it('uses custom ARTIFACT_BUCKET_BASE when provided', async () => {
    process.env.ARTIFACT_BUCKET_BASE = 'custom-artifacts';
    const customConfig = { ...testConfig, artifactBucketBase: 'custom-artifacts' };
    mockDeriveTrack.mockReturnValue('v1');
    mockReadReleasePointer.mockResolvedValue({
      version: '1.2.4',
      s3Location: { bucket: 'test-bucket', key: 'test-key' },
    });
    mockBuildArtifactKey.mockReturnValue('edge-pkg/release/1.2.4/lambdas/edge-lambda.zip');

    const edgeLambdaArn = 'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda';

    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Successful',
    });
    lambdaMock.on(PublishVersionCommand).resolves({
      FunctionArn: edgeLambdaArn + ':5',
    });

    const distribution = createDistributionWithEdgeLambda('DIST123', edgeLambdaArn, '3');
    cloudFrontMock.on(ListDistributionsCommand).resolves({
      DistributionList: {
        IsTruncated: false,
        Items: [distribution],
        Marker: '',
        MaxItems: 100,
        Quantity: 1,
      },
    });

    const distConfig = createDistributionConfig(edgeLambdaArn, '3');
    cloudFrontMock.on(GetDistributionConfigCommand).resolves({
      DistributionConfig: distConfig,
      ETag: 'test-etag-123',
    });

    cloudFrontMock.on(UpdateDistributionCommand).resolves({});
    lambdaMock.on(TagResourceCommand).resolves({});
    const logger = new LoggerBuffer();

    const updated = await advanceEdgeLambdaIfStale(
      edgeLambdaArn,
      'edge-pkg',
      'edge-lambda',
      '1.2.3',
      logger,
      customConfig,
    );

    expect(updated).toBe(true);
    const updateCalls = lambdaMock.commandCalls(UpdateFunctionCodeCommand);
    expect(updateCalls[0].args[0].input.S3Bucket).toBe('custom-artifacts-us-east-1');
  });
});
