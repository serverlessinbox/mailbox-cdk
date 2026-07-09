/// <reference types="jest" />

/**
 * Unit and integration tests for the scheduled updater Lambda handler (stack-self-update, Phase B).
 *
 * Tests the handler's core logic by importing and exercising REAL functions from ../handler:
 * - tagMapFrom (pure function, no mocks)
 * - advanceLambdaIfStale, handler (integration tests, aws-sdk-client-mock)
 *
 * PENDING PUBLISH NOTE: This test suite imports from @serverlessinbox/artifact-registry,
 * which has NOT been published yet. The tests are written fully and correct, but will not
 * execute until artifact-registry is published to npm and mailbox's package.json is updated
 * with the new version.
 */

import { mockClient } from 'aws-sdk-client-mock';
import { LambdaClient, UpdateFunctionCodeCommand, TagResourceCommand } from '@aws-sdk/client-lambda';
import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { tagMapFrom, advanceLambdaIfStale, handler } from '../handler';

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

describe('Scheduled Updater Handler - Unit Tests', () => {
  describe('tagMapFrom', () => {
    it('converts tags array to record and preserves all keys/values', () => {
      const tags = [
        { Key: 'serverless-inbox:artifact-name', Value: 'mailbox-go' },
        { Key: 'serverless-inbox:artifact-package', Value: 'mailbox-go' },
        { Key: 'serverless-inbox:artifact-version', Value: '1.2.3' },
        { Key: 'tag-other', Value: 'value-other' },
      ];
      const map = tagMapFrom(tags);
      expect(map['serverless-inbox:artifact-name']).toBe('mailbox-go');
      expect(map['serverless-inbox:artifact-package']).toBe('mailbox-go');
      expect(map['serverless-inbox:artifact-version']).toBe('1.2.3');
      expect(map['tag-other']).toBe('value-other');
    });

    it('skips tags with missing Key or Value', () => {
      const tags = [
        { Key: 'serverless-inbox:artifact-name', Value: 'mailbox-go' },
        { Key: 'incomplete-key' }, // Missing Value
        { Value: 'incomplete-value' }, // Missing Key
      ];
      const map = tagMapFrom(tags);
      expect(Object.keys(map).length).toBe(1);
      expect(map['serverless-inbox:artifact-name']).toBe('mailbox-go');
    });

    it('returns empty record for undefined or empty tags', () => {
      expect(tagMapFrom(undefined)).toEqual({});
      expect(tagMapFrom([])).toEqual({});
    });
  });
});

describe('Scheduled Updater Handler - Integration Tests', () => {
  const lambdaMock = mockClient(LambdaClient);
  const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);

  // Get mocked functions from artifact-registry mock
  const mockReadReleasePointer = readReleasePointer as jest.Mock;
  const mockDeriveTrack = deriveTrack as jest.Mock;
  const mockBuildArtifactKey = buildArtifactKey as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    lambdaMock.reset();
    taggingMock.reset();
    // Reset environment variables
    delete process.env.DIST_TAG;
    delete process.env.GRANULARITY;
    delete process.env.PROJECT;
    delete process.env.ARTIFACT_BUCKET_BASE;
    delete process.env.ROOT_STACK_TAG_VALUE;
    delete process.env.AWS_REGION;
  });

  describe('advanceLambdaIfStale', () => {
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

    it('skips resources with auto-update exclusion tag (serverless-inbox:auto-update=exclude)', async () => {
      process.env.ROOT_STACK_TAG_VALUE = 'my-stack';

      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:scheduled-updater',
            Tags: [
              { Key: 'serverless-inbox:root-stack', Value: 'my-stack' },
              { Key: 'serverless-inbox:artifact-package', Value: 'scheduled-updater' },
              { Key: 'serverless-inbox:artifact-name', Value: 'scheduled-updater' },
              { Key: 'serverless-inbox:artifact-version', Value: '1.0.0' },
              { Key: 'serverless-inbox:auto-update', Value: 'exclude' },
            ],
          },
        ],
      });

      await handler();

      // Verify advanceLambdaIfStale was NOT called (resource was skipped due to exclude tag)
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
          ResourceTagMappingList: [lambdaResource('arn:aws:lambda:us-east-1:123456789012:function:lambda-1', 'pkg1', 'lambda-1', '1.0.0')],
          PaginationToken: 'next-token',
        })
        .resolvesOnce({
          ResourceTagMappingList: [lambdaResource('arn:aws:lambda:us-east-1:123456789012:function:lambda-2', 'pkg2', 'lambda-2', '1.0.0')],
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
          lambdaResource('arn:aws:lambda:us-east-1:123456789012:function:mailbox-go', 'mailbox-go', 'mailbox-go', '1.2.3'),
          lambdaResource('arn:aws:lambda:us-east-1:123456789012:function:admin-api', 'admin-api', 'admin-api', '1.0.0'),
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
