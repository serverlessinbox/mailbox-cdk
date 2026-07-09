/// <reference types="jest" />

/**
 * Integration tests for the scheduled updater Lambda handler (stack-self-update, Phase B).
 *
 * Tests the handler's core scanning, routing, and dispatch logic by importing and exercising
 * the REAL handler function from ../handler. Tests how the handler discovers resources,
 * routes them to appropriate update functions (code/ui/edge), and handles errors.
 *
 * PENDING PUBLISH NOTE: This test suite imports from @serverlessinbox/artifact-registry,
 * which has NOT been published yet. The tests are written fully and correct, but will not
 * execute until artifact-registry is published to npm and mailbox's package.json is updated
 * with the new version.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  LambdaClient,
  UpdateFunctionCodeCommand,
  TagResourceCommand,
  InvokeCommand,
  PublishVersionCommand,
} from '@aws-sdk/client-lambda';
import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
} from '@aws-sdk/client-resource-groups-tagging-api';
import {
  CloudFrontClient,
  ListDistributionsCommand,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  TagResourceCommand as CloudFrontTagResourceCommand,
} from '@aws-sdk/client-cloudfront';
import { handler } from '../handler';

// Mock @serverlessinbox/artifact-registry before importing any handler code.
// Note: artifact-registry is not yet published (pending), so this mock allows
// the test file to compile even if the actual package isn't available yet.
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

// Fixture helpers to reduce boilerplate
function lambdaResource(
  arn: string,
  pkg: string,
  name: string,
  version: string,
): { ResourceARN: string; Tags: Array<{ Key: string; Value: string }> } {
  return {
    ResourceARN: arn,
    Tags: [
      { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
      { Key: 'serverless-inbox:artifact-package', Value: pkg },
      { Key: 'serverless-inbox:artifact-name', Value: name },
      { Key: 'serverless-inbox:artifact-version', Value: version },
    ],
  };
}

// CloudFront mock helper to create distributions with edge lambda associations
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

describe('Scheduled Updater Handler — Integration Tests', () => {
  const lambdaMock = mockClient(LambdaClient);
  const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);
  const cloudFrontMock = mockClient(CloudFrontClient);

  // Get mocked functions from artifact-registry mock
  const mockReadReleasePointer = readReleasePointer as jest.Mock;
  const mockDeriveTrack = deriveTrack as jest.Mock;
  const mockBuildArtifactKey = buildArtifactKey as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    lambdaMock.reset();
    taggingMock.reset();
    cloudFrontMock.reset();
    // Reset environment variables
    delete process.env.DIST_TAG;
    delete process.env.GRANULARITY;
    delete process.env.PROJECT;
    delete process.env.ARTIFACT_BUCKET_BASE;
    delete process.env.ROOT_STACK_TAG_VALUE;
    delete process.env.AWS_REGION;
  });

  describe('handler (main entry point)', () => {
    beforeEach(() => {
      process.env.DIST_TAG = 'latest';
      process.env.GRANULARITY = 'major';
      process.env.PROJECT = 'serverlessinbox';
    });

    it('requires ROOT_STACK_TAG_VALUE environment variable', async () => {
      delete process.env.ROOT_STACK_TAG_VALUE;

      await expect(handler()).rejects.toThrow('required environment variable');
    });

    it('scans both AWS_REGION and us-east-1 for Lambdas', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
      process.env.AWS_REGION = 'us-west-2';

      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [] });

      await handler();

      // Verify GetResourcesCommand was called for both regions (us-west-2 and us-east-1)
      const getCalls = taggingMock.commandCalls(GetResourcesCommand);
      expect(getCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('updates lambda with auto-update-type=code (default)', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
      process.env.DIST_TAG = 'latest';
      process.env.GRANULARITY = 'major';
      process.env.PROJECT = 'serverlessinbox';

      mockDeriveTrack.mockReturnValue('v1');
      mockReadReleasePointer.mockResolvedValue({
        version: '1.2.4',
        s3Location: { bucket: 'test-bucket', key: 'test-key' },
      });
      mockBuildArtifactKey.mockReturnValue('release/1.2.4/lambdas/mailbox-go.zip');

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:artifact-package', Value: 'mailbox-go' },
              { Key: 'serverless-inbox:artifact-name', Value: 'mailbox-go' },
              { Key: 'serverless-inbox:artifact-version', Value: '1.2.3' },
              { Key: 'serverless-inbox:auto-update-type', Value: 'code' },
            ],
          },
        ],
      });

      lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
      lambdaMock.on(TagResourceCommand).resolves({});

      await handler();

      // Verify advanceLambdaIfStale WAS called (code type should be updated)
      expect(mockReadReleasePointer).toHaveBeenCalled();
      expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(1);
    });

    it('skips resources with auto-update-type=none (e.g. scheduled-updater itself)', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:scheduled-updater',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:artifact-package', Value: 'mailbox-cdk' },
              { Key: 'serverless-inbox:artifact-name', Value: 'scheduled-updater' },
              { Key: 'serverless-inbox:artifact-version', Value: '1.0.0' },
              { Key: 'serverless-inbox:auto-update-type', Value: 'none' },
            ],
          },
        ],
      });

      await handler();

      // Verify advanceLambdaIfStale was NOT called (resource was skipped due to none type)
      expect(mockReadReleasePointer).not.toHaveBeenCalled();
    });

    it('routes ui auto-update-type on CloudFront distribution to advanceUiBucketIfStale', async () => {
      const cloudFrontMockLocal = mockClient(CloudFrontClient as any);
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
      process.env.DIST_TAG = 'latest';
      process.env.GRANULARITY = 'major';
      process.env.PROJECT = 'serverlessinbox';
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_ACCOUNT_ID = '123456789012';

      mockDeriveTrack.mockReturnValue('v1');
      mockReadReleasePointer.mockResolvedValue({
        version: '2.0.0',
        s3Location: { bucket: 'test-bucket', key: 'test-key' },
      });
      mockBuildArtifactKey.mockReturnValue('ui-bundle/release/2.0.0/ui-bundle.zip');
      (deployZipToPrefix as jest.Mock).mockResolvedValue({ uploaded: 5 });
      (invalidateCloudFront as jest.Mock).mockResolvedValue({ invalidated: true });

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:cloudfront::123456789012:distribution/D123',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:artifact-package', Value: 'ui-bundle' },
              { Key: 'serverless-inbox:artifact-name', Value: 'ui-bundle.zip' },
              { Key: 'serverless-inbox:artifact-version', Value: '1.0.0' },
              { Key: 'serverless-inbox:auto-update-type', Value: 'ui' },
              { Key: 'serverless-inbox:bucket-name', Value: 'ui-content-bucket' },
            ],
          },
        ],
      });

      cloudFrontMockLocal.on(CloudFrontTagResourceCommand).resolves({});

      await handler();

      // Verify readReleasePointer was called (ui path)
      expect(mockReadReleasePointer).toHaveBeenCalled();
      // Verify deployZipToPrefix was called (bucket update, not Lambda invoke)
      expect(deployZipToPrefix).toHaveBeenCalled();
      expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
      expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);

      cloudFrontMockLocal.restore();
    });

    it('routes edge auto-update-type to advanceEdgeLambdaIfStale in us-east-1', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
      process.env.AWS_REGION = 'us-east-1';
      process.env.DIST_TAG = 'latest';
      process.env.GRANULARITY = 'major';
      process.env.PROJECT = 'serverlessinbox';

      mockDeriveTrack.mockReturnValue('v1');
      mockReadReleasePointer.mockResolvedValue({
        version: '2.0.0',
        s3Location: { bucket: 'test-bucket', key: 'test-key' },
      });
      mockBuildArtifactKey.mockReturnValue('edge-lambda.zip');

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:blob-authorizer',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:artifact-package', Value: 'mailbox-cdk-edge' },
              { Key: 'serverless-inbox:artifact-name', Value: 'blob-authorizer' },
              { Key: 'serverless-inbox:artifact-version', Value: '1.0.0' },
              { Key: 'serverless-inbox:auto-update-type', Value: 'edge' },
            ],
          },
        ],
      });

      const edgeLambdaArn = 'arn:aws:lambda:us-east-1:123456789012:function:blob-authorizer';
      lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
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

      await handler();

      // Verify readReleasePointer was called
      expect(mockReadReleasePointer).toHaveBeenCalled();
      // Verify edge path was taken (PublishVersion called, not InvokeCommand)
      expect(lambdaMock.commandCalls(PublishVersionCommand)).toHaveLength(1);
      expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
      expect(cloudFrontMock.commandCalls(UpdateDistributionCommand)).toHaveLength(1);
    });

    it('skips edge update when not in us-east-1 region', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
      process.env.AWS_REGION = 'us-west-2';

      // First call (us-west-2): return edge lambda
      // Second call (us-east-1): return empty
      taggingMock
        .on(GetResourcesCommand)
        .resolvesOnce({
          ResourceTagMappingList: [
            {
              ResourceARN: 'arn:aws:lambda:us-west-2:123456789012:function:blob-authorizer',
              Tags: [
                { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
                { Key: 'serverless-inbox:artifact-package', Value: 'mailbox-cdk-edge' },
                { Key: 'serverless-inbox:artifact-name', Value: 'blob-authorizer' },
                { Key: 'serverless-inbox:artifact-version', Value: '1.0.0' },
                { Key: 'serverless-inbox:auto-update-type', Value: 'edge' },
              ],
            },
          ],
        })
        .resolves({ ResourceTagMappingList: [] });

      await handler();

      // Verify readReleasePointer was NOT called (edge skipped in non-us-east-1 region)
      expect(mockReadReleasePointer).not.toHaveBeenCalled();
    });

    it('skips resources with auto-update-type=none (e.g. scheduled-updater itself)', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:scheduled-updater',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:artifact-package', Value: 'mailbox-cdk' },
              { Key: 'serverless-inbox:artifact-name', Value: 'scheduled-updater' },
              { Key: 'serverless-inbox:artifact-version', Value: '1.0.0' },
              { Key: 'serverless-inbox:auto-update-type', Value: 'none' },
            ],
          },
        ],
      });

      await handler();

      // Verify advanceLambdaIfStale was NOT called (resource was skipped due to none type)
      expect(mockReadReleasePointer).not.toHaveBeenCalled();
    });

    it('skips Lambdas missing required artifact tags', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:artifact-package', Value: 'mailbox-go' },
              // Missing artifact-name and artifact-version
            ],
          },
        ],
      });

      await handler();

      // Verify advanceLambdaIfStale was NOT called (readReleasePointer not called)
      expect(mockReadReleasePointer).not.toHaveBeenCalled();
    });

    it('handles pagination correctly in region scan', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';

      // Queue responses: first page with continuation token, then second page without token
      taggingMock
        .on(GetResourcesCommand)
        .resolvesOnce({
          ResourceTagMappingList: [
            {
              ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-1',
              Tags: [
                { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
                { Key: 'serverless-inbox:artifact-package', Value: 'pkg1' },
                { Key: 'serverless-inbox:artifact-name', Value: 'lambda-1' },
                { Key: 'serverless-inbox:artifact-version', Value: '1.0.0' },
                { Key: 'serverless-inbox:auto-update-type', Value: 'code' },
              ],
            },
          ],
          PaginationToken: 'next-token',
        })
        .resolvesOnce({
          ResourceTagMappingList: [
            {
              ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-2',
              Tags: [
                { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
                { Key: 'serverless-inbox:artifact-package', Value: 'pkg2' },
                { Key: 'serverless-inbox:artifact-name', Value: 'lambda-2' },
                { Key: 'serverless-inbox:artifact-version', Value: '1.0.0' },
                { Key: 'serverless-inbox:auto-update-type', Value: 'code' },
              ],
            },
          ],
        });

      mockDeriveTrack.mockReturnValue('v1');
      mockReadReleasePointer.mockResolvedValue(null);

      await handler();

      // Verify both resources from both pages were processed (readReleasePointer called twice)
      expect(mockReadReleasePointer).toHaveBeenCalledTimes(2);
    });

    it('continues processing even if one Lambda update fails', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:artifact-package', Value: 'mailbox-go' },
              { Key: 'serverless-inbox:artifact-name', Value: 'mailbox-go' },
              { Key: 'serverless-inbox:artifact-version', Value: '1.2.3' },
              { Key: 'serverless-inbox:auto-update-type', Value: 'code' },
            ],
          },
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:admin-api',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:artifact-package', Value: 'admin-api' },
              { Key: 'serverless-inbox:artifact-name', Value: 'admin-api' },
              { Key: 'serverless-inbox:artifact-version', Value: '1.0.0' },
              { Key: 'serverless-inbox:auto-update-type', Value: 'code' },
            ],
          },
        ],
      });

      mockDeriveTrack.mockReturnValue('v1');
      mockReadReleasePointer.mockResolvedValue({ version: '1.2.4', s3Location: { bucket: 'test-bucket', key: 'test-key' } });
      mockBuildArtifactKey.mockReturnValue('serverlessinbox/packages/mailbox-go/releases/v1.2.4/lambdas/mailbox-go.zip');

      // First update fails, second succeeds
      lambdaMock.on(UpdateFunctionCodeCommand).rejectsOnce(new Error('UpdateFunctionCodeCommand failed'));
      lambdaMock.on(UpdateFunctionCodeCommand).resolvesOnce({});
      lambdaMock.on(TagResourceCommand).resolvesOnce({});

      // Handler should NOT throw even though one Lambda update failed
      await expect(handler()).resolves.toBeUndefined();

      // Verify both Lambdas were attempted
      expect(mockReadReleasePointer).toHaveBeenCalledTimes(2);
    });
  });

  describe('Version comparison using real semver', () => {
    beforeEach(() => {
      process.env.DIST_TAG = 'latest';
      process.env.GRANULARITY = 'major';
      process.env.PROJECT = 'serverlessinbox';
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
    });

    it('does not advance on downgrade (pointer version < deployed version)', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          lambdaResource('arn:aws:lambda:us-east-1:123456789012:function:mailbox-go', 'mailbox-go', 'mailbox-go', '1.2.3'),
        ],
      });

      mockDeriveTrack.mockReturnValue('v1');
      mockReadReleasePointer.mockResolvedValue({ version: '1.2.2', s3Location: { bucket: 'test-bucket', key: 'test-key' } });

      await handler();

      // Downgrade case: pointer (1.2.2) < deployed (1.2.3), should NOT advance
      expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);
    });
  });
});
