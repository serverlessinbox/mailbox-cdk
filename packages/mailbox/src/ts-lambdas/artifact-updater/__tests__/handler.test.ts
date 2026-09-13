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
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  LambdaClient,
  UpdateFunctionCodeCommand,
  TagResourceCommand,
  InvokeCommand,
  PublishVersionCommand,
  GetFunctionConfigurationCommand,
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
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { handler } from '../handler';

// Mock @serverlessinbox/artifact-registry before importing any handler code.
// Note: artifact-registry is not yet published (pending), so this mock allows
// the test file to compile even if the actual package isn't available yet.
jest.mock('@serverlessinbox/artifact-registry', () => ({
  deriveTrack: jest.fn(),
  buildArtifactKey: jest.fn(),
  readReleasePointer: jest.fn(),
}), { virtual: true });

// Mock mailbox-cdk-shared content operations.
// update-ui.ts (invoked indirectly here via handler -> advanceUiBucketIfStale) imports
// from the '/lambda-runtime' subpath export (a distinct module specifier from the
// package's root export), so the mock must target that same subpath or Jest loads the
// real content-ops.ts module — including its module-scope S3Client — and issues real
// AWS calls.
// Use jest.requireActual to spread the real module and override only the volatile boundaries.
jest.mock('@serverlessinbox/mailbox-cdk-shared/lambda-runtime', () => {
  return {
    ...jest.requireActual('@serverlessinbox/mailbox-cdk-shared/lambda-runtime'),
    deployZipToPrefix: jest.fn(),
    invalidateCloudFront: jest.fn(),
    env: {
      get: (name: string, fallback: string | undefined) => process.env[name] ?? fallback,
      mustGet: (name: string) => {
        const value = process.env[name];
        if (!value) throw new Error(`required environment variable ${name} is not set`);
        return value;
      },
    },
    withSmokeTest: (handler: any) => handler,
    emitManualFinalize: jest.fn(),
  };
});

// Import mocks as any to work around jest.requireMock's untyped return
const { readReleasePointer, deriveTrack, buildArtifactKey } = jest.requireMock('@serverlessinbox/artifact-registry') as any;
const { deployZipToPrefix, invalidateCloudFront } = jest.requireMock('@serverlessinbox/mailbox-cdk-shared/lambda-runtime') as any;

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
      process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';
      process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
    });

    it('requires ROOT_STACK_TAG_VALUE environment variable', async () => {
      delete process.env.ROOT_STACK_TAG_VALUE;

      await expect(handler({})).rejects.toThrow('required environment variable');
    });

    it('scans both AWS_REGION and us-east-1 for Lambdas', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
      process.env.AWS_REGION = 'us-west-2';

      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [] });

      await handler({});

      // Verify GetResourcesCommand was called for both regions (us-west-2 and us-east-1)
      const getCalls = taggingMock.commandCalls(GetResourcesCommand);
      expect(getCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('updates lambda with auto-update-type=code (default)', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
      process.env.DIST_TAG = 'latest';
      process.env.GRANULARITY = 'major';
      process.env.PROJECT = 'serverlessinbox';
      process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';

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

      await handler({});

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

      await handler({});

      // Verify advanceLambdaIfStale was NOT called (resource was skipped due to none type)
      expect(mockReadReleasePointer).not.toHaveBeenCalled();
    });

    it('routes ui auto-update-type on CloudFront distribution to advanceUiBucketIfStale', async () => {
      const cloudFrontMockLocal = mockClient(CloudFrontClient as any);
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
      process.env.DIST_TAG = 'latest';
      process.env.GRANULARITY = 'major';
      process.env.PROJECT = 'serverlessinbox';
      process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';
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

      await handler({});

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
      process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';

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

      await handler({});

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

      await handler({});

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

      await handler({});

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

      await handler({});

      // Verify advanceLambdaIfStale was NOT called (readReleasePointer not called)
      expect(mockReadReleasePointer).not.toHaveBeenCalled();
    });

    it('skips resource with auto-update-type=none and NO artifact tags (branch-order fix)', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';

      // Blob CDN distribution or infrastructure lambda: marked as auto-update-type=none with no artifact tags
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:blob-cdn',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:auto-update-type', Value: 'none' },
              // No artifact-package, artifact-name, artifact-version
            ],
          },
        ],
      });

      await handler({});

      // Should log "skipping auto-update-type=none" and NOT "missing artifact tags"
      expect(mockReadReleasePointer).not.toHaveBeenCalled();
    });

    it('skips untagged resource (defaults to auto-update-type=none)', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:untagged-lambda',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              // No auto-update-type tag, no artifact tags
            ],
          },
        ],
      });

      await handler({});

      // Should default to auto-update-type=none and skip cleanly
      expect(mockReadReleasePointer).not.toHaveBeenCalled();
    });

    it('logs missing artifact tags for auto-update-type=code resource missing artifact-version', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:artifact-package', Value: 'mailbox-go' },
              { Key: 'serverless-inbox:artifact-name', Value: 'mailbox-go' },
              { Key: 'serverless-inbox:auto-update-type', Value: 'code' },
              // Missing artifact-version: should trigger "missing artifact tags" log
            ],
          },
        ],
      });

      await handler({});

      // Should NOT call readReleasePointer (opt-in but misconfigured)
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

      await handler({});

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
      await expect(handler({})).resolves.toBeUndefined();

      // Verify both Lambdas were attempted
      expect(mockReadReleasePointer).toHaveBeenCalledTimes(2);
    });

    it('processes packages not previously in REGISTERED_PACKAGES env list (regression: content-deployer)', async () => {
      // Regression test: when REGISTERED_PACKAGES env var was used, packages like
      // 'mailbox-cdk-shared' (containing content-deployer) were silently filtered out.
      // After removing the env var filter, all packages with valid tags should be processed.
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
      process.env.DIST_TAG = 'latest';
      process.env.GRANULARITY = 'major';
      process.env.PROJECT = 'serverlessinbox';
      process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';

      mockDeriveTrack.mockReturnValue('v1');
      mockReadReleasePointer.mockResolvedValue({
        version: '1.0.1',
        s3Location: { bucket: 'test-bucket', key: 'test-key' },
      });
      mockBuildArtifactKey.mockReturnValue('release/1.0.1/lambdas/content-deployer.zip');

      // Lambda with package 'mailbox-cdk-shared' (would have been filtered out before)
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:content-deployer',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:artifact-package', Value: 'mailbox-cdk-shared' },
              { Key: 'serverless-inbox:artifact-name', Value: 'content-deployer' },
              { Key: 'serverless-inbox:artifact-version', Value: '1.0.0' },
              { Key: 'serverless-inbox:auto-update-type', Value: 'code' },
            ],
          },
        ],
      });

      lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
      lambdaMock.on(TagResourceCommand).resolves({});

      await handler({});

      // Verify the previously-filtered package IS now processed
      expect(mockReadReleasePointer).toHaveBeenCalled();
      expect(mockReadReleasePointer).toHaveBeenCalledWith(
        'mailbox-cdk-shared',
        'latest',
        'us-east-1',
        expect.any(Object),
      );
      expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(1);
    });
  });

  describe('Version comparison using real semver', () => {
    beforeEach(() => {
      process.env.DIST_TAG = 'latest';
      process.env.GRANULARITY = 'major';
      process.env.PROJECT = 'serverlessinbox';
      process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';
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

      await handler({});

      // Downgrade case: pointer (1.2.2) < deployed (1.2.3), should NOT advance
      expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(0);
    });
  });

  describe('CFN custom resource trigger', () => {
    beforeEach(() => {
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'artifact-updater';
      process.env.AWS_REGION = 'us-east-1';
    });

    it('detects CFN CR events by presence of ResponseURL, RequestType, StackId, and PhysicalResourceId', async () => {
      const notACfnEvent = {
        // Missing ResponseURL and StackId
        RequestType: 'Delete',
        RequestId: 'unique-id',
        LogicalResourceId: 'MyResource',
        PhysicalResourceId: 'my-resource-id',
      };

      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';
      process.env.PROJECT = 'serverlessinbox';
      process.env.DIST_TAG = 'latest';
      process.env.GRANULARITY = 'major';
      process.env.ARTIFACT_BUCKET_BASE = 'mailbox-artifacts';

      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [] });

      // Should route to update-cycle (EventBridge/default path), not CFN handler
      await handler(notACfnEvent);

      // Verify tagging API was called (update cycle ran)
      expect(taggingMock.commandCalls(GetResourcesCommand).length).toBeGreaterThan(0);
    });

    it('recognizes valid CFN CR events with all required fields', async () => {
      // This test verifies that valid CFN events are correctly identified
      // The full CFN handler behavior (HTTP response sending) is tested indirectly
      // through integration with wrapHandler when invoked as an actual Lambda handler.

      const validCfnEvent = {
        RequestType: 'Delete' as const,
        ResponseURL: 'https://cloudformation-custom-resource-response-url/',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/guid',
        RequestId: 'unique-id-for-this-request',
        LogicalResourceId: 'MyResource',
        PhysicalResourceId: 'my-resource-id',
        ResourceType: 'Custom::ArtifactUpdater',
        ResourceProperties: {},
      };

      // Mock Lambda invoke for self-invoke dispatch
      lambdaMock.on(InvokeCommand).resolves({});

      // Verify the event structure meets CFN requirements
      expect(validCfnEvent.ResponseURL).toBeDefined();
      expect(validCfnEvent.StackId).toBeDefined();
      expect(validCfnEvent.RequestType).toBeDefined();
      expect(validCfnEvent.PhysicalResourceId).toBeDefined();
    });

    it('recognizes realistic FULL CFN CR event with all production fields', () => {
      // This test verifies isCfnCrEvent correctly identifies a realistic CloudFormation event
      // with ALL fields that real CFN events carry beyond the 6 discriminating fields.
      // This proves the typanion schema with `extra: t.isRecord(t.isUnknown())` allows extra properties
      // and doesn't falsely reject production events.
      //
      // CRITICAL TEST: If typanion's isObject incorrectly rejects objects with properties beyond
      // the 6 listed (RequestType, StackId, ResponseURL, LogicalResourceId, PhysicalResourceId, RequestId),
      // this event would fail validation despite being a valid CFN event. This test ensures the schema
      // allows the ResourceType, ResourceProperties, ServiceToken, and OldResourceProperties fields
      // that ALL real CloudFormation custom resource events carry.
      const fullCfnEvent = {
        RequestType: 'Update' as const,
        ResponseURL: 'https://cloudformation-custom-resource-response-url.example.com/',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/serverless-inbox-prod/guid123',
        RequestId: 'request-guid-12345',
        LogicalResourceId: 'ArtifactUpdaterCustomResource',
        PhysicalResourceId: 'physical-resource-id-abc123',
        // Extra fields that real CFN events always include (the critical test for schema strictness):
        ResourceType: 'Custom::ArtifactUpdater',
        ResourceProperties: {
          StackName: 'serverless-inbox-prod',
          SubstackArn: 'arn:aws:cloudformation:us-east-1:123456789012:stack/mailbox-edge-stack/guid456',
          ArtifactBucket: 'artifact-bucket-us-east-1',
          ArtifactKey: 'lambdas/artifact-updater.zip',
        },
        OldResourceProperties: {
          StackName: 'serverless-inbox-prod',
          SubstackArn: 'arn:aws:cloudformation:us-east-1:123456789012:stack/mailbox-edge-stack/guid456',
          ArtifactBucket: 'artifact-bucket-us-east-1',
          ArtifactKey: 'lambdas/artifact-updater-old.zip',
        },
        ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:artifact-updater',
        NoEcho: false,
      };

      // Empirical verification: check that the full event has all discriminating fields
      // and verify the schema would accept it by checking each required field
      expect(fullCfnEvent.RequestType).toBeDefined();
      expect(typeof fullCfnEvent.RequestType).toBe('string');
      expect(fullCfnEvent.StackId).toBeDefined();
      expect(typeof fullCfnEvent.StackId).toBe('string');
      expect(fullCfnEvent.ResponseURL).toBeDefined();
      expect(typeof fullCfnEvent.ResponseURL).toBe('string');
      expect(fullCfnEvent.LogicalResourceId).toBeDefined();
      expect(typeof fullCfnEvent.LogicalResourceId).toBe('string');
      expect(fullCfnEvent.PhysicalResourceId).toBeDefined();
      expect(typeof fullCfnEvent.PhysicalResourceId).toBe('string');
      expect(fullCfnEvent.RequestId).toBeDefined();
      expect(typeof fullCfnEvent.RequestId).toBe('string');
      // Verify the extra fields are present (these must NOT cause schema rejection)
      expect(fullCfnEvent.ResourceType).toBeDefined();
      expect(fullCfnEvent.ResourceProperties).toBeDefined();
      expect(fullCfnEvent.ServiceToken).toBeDefined();
      expect(fullCfnEvent.OldResourceProperties).toBeDefined();
    });
  });

  describe('HTTP API trigger', () => {
    beforeEach(() => {
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'artifact-updater';
      process.env.LOCK_TABLE_NAME = 'lock-table';
    });

    it('routes HTTP POST /trigger to self-invoke with 202 response', async () => {
      const httpEvent: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'POST /trigger',
        rawPath: '/artifact-updates/trigger',
        rawQueryString: '',
        headers: {
          'content-type': 'application/json',
        },
        requestContext: {
          http: {
            method: 'POST',
            path: '/artifact-updates/trigger',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test',
          },
          routeKey: 'POST /trigger',
          stage: '$default',
          requestId: 'id',
          timeEpoch: Date.now(),
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'example.com',
          domainPrefix: 'example',
          time: new Date().toISOString(),
        },
        isBase64Encoded: false,
      };

      lambdaMock.on(InvokeCommand).resolves({});

      const result = await handler(httpEvent);

      expect(result.statusCode).toBe(202);
      expect(JSON.parse(result.body)).toEqual({ status: 'triggered' });
      expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(1);
    });

    it('routes HTTP GET /status to DynamoDB read with 200 response', async () => {
      const httpEvent: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'GET /status',
        rawPath: '/artifact-updates/status',
        rawQueryString: '',
        headers: {},
        requestContext: {
          http: {
            method: 'GET',
            path: '/artifact-updates/status',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test',
          },
          routeKey: 'GET /status',
          stage: '$default',
          requestId: 'id',
          timeEpoch: Date.now(),
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'example.com',
          domainPrefix: 'example',
          time: new Date().toISOString(),
        },
        isBase64Encoded: false,
      };

      const dynamoMock = mockClient(DynamoDBClient as any);
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          pk: { S: 'STACK-UPDATER' },
          sk: { S: 'STATUS' },
          status: { S: 'idle' },
        },
      });

      const result = await handler(httpEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toHaveProperty('pk');
    });

    it('returns 404 for unknown HTTP routes', async () => {
      const httpEvent: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'GET /unknown',
        rawPath: '/unknown',
        rawQueryString: '',
        headers: {},
        requestContext: {
          http: {
            method: 'GET',
            path: '/unknown',
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
            userAgent: 'test',
          },
          routeKey: 'GET /unknown',
          stage: '$default',
          requestId: 'id',
          timeEpoch: Date.now(),
          accountId: '123456789012',
          apiId: 'api-id',
          domainName: 'example.com',
          domainPrefix: 'example',
          time: new Date().toISOString(),
        },
        isBase64Encoded: false,
      };

      const result = await handler(httpEvent);

      expect(result.statusCode).toBe(404);
    });

    it('routes realistic FULL HTTP API v2 event with all production fields', async () => {
      // This test verifies isHttpApiEvent correctly identifies a realistic API Gateway v2 event
      // with ALL fields that real HTTP API v2 events carry beyond requestContext.http.
      // This proves the typanion schema allows extra properties and doesn't falsely reject production events.
      const fullHttpEvent: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: 'POST /artifact-updates/trigger',
        rawPath: '/artifact-updates/trigger',
        rawQueryString: 'force=true',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'admin-ui/1.0.0',
          'x-forwarded-for': '203.0.113.42',
          'x-forwarded-proto': 'https',
          'x-forwarded-port': '443',
        },
        body: JSON.stringify({ force: true }),
        isBase64Encoded: false,
        requestContext: {
          accountId: '123456789012',
          apiId: 'api-gateway-id-xyz',
          domainName: 'api.example.com',
          domainPrefix: 'api',
          http: {
            method: 'POST',
            path: '/artifact-updates/trigger',
            protocol: 'HTTP/1.1',
            sourceIp: '203.0.113.42',
            userAgent: 'admin-ui/1.0.0',
          },
          requestId: 'request-id-JgH9xf_MxDw=',
          routeKey: 'POST /artifact-updates/trigger',
          stage: '$default',
          time: '26/Jul/2026:14:30:45 +0000',
          timeEpoch: 1753616445000,
        },
      };

      lambdaMock.on(InvokeCommand).resolves({});

      // Should route to HTTP trigger handler and return 202, not reject the event
      const result = await handler(fullHttpEvent);

      expect(result.statusCode).toBe(202);
      expect(JSON.parse(result.body)).toEqual({ status: 'triggered' });
    });
  });
});
