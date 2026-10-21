/// <reference types="jest" />

/**
 * Pins the UI update path: the bundle is unpacked into the bucket from the deployment region's artifact
 * bucket, the distribution is invalidated, and only then is the new version tagged on the distribution. A
 * version tagged before the content is in place would stop a failed update from being tried again. The
 * content operations and the release registry are faked because they read and write S3.
 */

import { CloudFrontClient, TagResourceCommand }                                                      from '@aws-sdk/client-cloudfront';
import type { S3Client }                                                                             from '@aws-sdk/client-s3';
import { LoggerBuffer, type Region }                                                                 from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                                                                from 'aws-sdk-client-mock';

import { ReleaseArtifacts }                                                                          from '../release-artifacts';
import { UiBucketUpdater }                                                                           from '../ui-bucket-updater';

import { DISTRIBUTION_ARN, EU_WEST_1, fakeUpdaterClients, testConfig, uiTarget, type RegistryMocks } from './updater-helpers';

jest.mock('@serverlessinbox/artifact-registry', () => ({
  deriveTrack: jest.fn(),
  buildArtifactKey: jest.fn(),
  readReleasePointer: jest.fn(),
}));

jest.mock('@serverlessinbox/mailbox-cdk-shared/lambda-runtime', () => ({
  ...jest.requireActual('@serverlessinbox/mailbox-cdk-shared/lambda-runtime'),
  deployZipToPrefix: jest.fn(),
  invalidateCloudFront: jest.fn(),
}));

/** The content operations the suite fakes, which it sets up per test. */
interface ContentOperationMocks {
  readonly deployZipToPrefix: jest.Mock;
  readonly invalidateCloudFront: jest.Mock;
}

/** The updater under test and the registry S3 client it was given. */
interface UpdaterFixture {
  readonly updater: UiBucketUpdater;
  readonly registryS3: S3Client;
}

const { readReleasePointer, deriveTrack, buildArtifactKey } = jest.requireMock(
  '@serverlessinbox/artifact-registry',
) as RegistryMocks;
const { deployZipToPrefix, invalidateCloudFront }           = jest.requireMock(
  '@serverlessinbox/mailbox-cdk-shared/lambda-runtime',
) as ContentOperationMocks;

describe('UiBucketUpdater', () => {
  const cloudFrontMock = mockClient(CloudFrontClient);

  function newUpdater(deploymentRegion?: Region): UpdaterFixture {
    const clients = fakeUpdaterClients(deploymentRegion);
    const logger  = new LoggerBuffer();
    const updater = new UiBucketUpdater(
      clients.registryS3,
      clients.deployment,
      clients.cloudFront,
      new ReleaseArtifacts(clients.registryS3, testConfig, logger),
      logger,
    );
    return { updater, registryS3: clients.registryS3 };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    cloudFrontMock.reset();
    cloudFrontMock.on(TagResourceCommand).resolves({});
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    deriveTrack.mockReturnValue('v1');
    readReleasePointer.mockResolvedValue({ version: '1.2.4' });
    buildArtifactKey.mockReturnValue('ui-bundle/release/1.2.4/ui-bundle.zip');
    deployZipToPrefix.mockResolvedValue({ uploaded: 42 });
    invalidateCloudFront.mockResolvedValue({ invalidated: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing and reports false when the bundle is not behind', async () => {
    readReleasePointer.mockResolvedValue(null);

    const updated = await newUpdater().updater.advanceIfStale(uiTarget());

    expect(updated).toBe(false);
    expect(deployZipToPrefix).not.toHaveBeenCalled();
    expect(cloudFrontMock.calls()).toHaveLength(0);
  });

  it('unpacks the bundle into the bucket, invalidates the distribution and tags the new version', async () => {
    const { updater, registryS3 } = newUpdater();

    const updated = await updater.advanceIfStale(uiTarget());

    expect(updated).toBe(true);
    expect(deployZipToPrefix).toHaveBeenCalledWith(registryS3, {
      sourceBucket: 'mailbox-artifacts-us-east-1',
      sourceKey: 'ui-bundle/release/1.2.4/ui-bundle.zip',
      targetBucket: 'ui-content-bucket',
      targetPrefix: 'content/',
    });
    expect(invalidateCloudFront).toHaveBeenCalledWith(expect.anything(), {
      distributionId: 'ABCD1234',
      paths: ['/*'],
      callerReference: expect.stringContaining('ui-update:ui-content-bucket:1.2.4:'),
    });
    expect(cloudFrontMock.commandCalls(TagResourceCommand)[0].args[0].input).toEqual({
      Resource: DISTRIBUTION_ARN,
      Tags: { Items: [{ Key: 'serverless-inbox:artifact-version', Value: '1.2.4' }] },
    });
  });

  it('reads the bundle from the artifact bucket of the deployment region', async () => {
    await newUpdater(EU_WEST_1).updater.advanceIfStale(uiTarget());

    expect(deployZipToPrefix).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceBucket: 'mailbox-artifacts-eu-west-1' }),
    );
  });

  it('rejects and logs, without invalidating or tagging, when the bundle cannot be unpacked', async () => {
    deployZipToPrefix.mockRejectedValue(new Error('S3 GetObject returned empty body'));

    await expect(newUpdater().updater.advanceIfStale(uiTarget())).rejects.toThrow('S3 GetObject returned empty body');

    expect(invalidateCloudFront).not.toHaveBeenCalled();
    expect(cloudFrontMock.commandCalls(TagResourceCommand)).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith('failed to update UI bucket', {
      bucketName: 'ui-content-bucket',
      distributionId: 'ABCD1234',
      error: 'S3 GetObject returned empty body',
    });
  });
});
