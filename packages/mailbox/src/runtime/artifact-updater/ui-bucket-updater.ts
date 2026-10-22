import { TagResourceCommand, type CloudFrontClient } from '@aws-sdk/client-cloudfront';
import type { S3Client }                             from '@aws-sdk/client-s3';
import {
  CaughtError,
  deployZipToPrefix,
  invalidateCloudFront,
  parseArn,
  ServerlessInboxTagKeys,
  type LoggerBuffer,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { UiTarget }                      from './artifact-target';
import type { ReleaseArtifacts, StaleTarget } from './release-artifacts';
import type { RegionClients }                 from './updater-clients';

const CONTENT_PREFIX = 'content/';

/**
 * Advances the content of a UI bucket to the newer release of its bundle, when there is one: unpacks the
 * bundle into the bucket, invalidates the CloudFront distribution in front of it and records the new
 * artifact version as a tag on the distribution. The bundle is read from the deployment region.
 */
export class UiBucketUpdater {
  private readonly registryS3: S3Client;
  private readonly deployment: RegionClients;
  private readonly cloudFront: CloudFrontClient;
  private readonly releases: ReleaseArtifacts;
  private readonly logger: LoggerBuffer;

  constructor(
    registryS3: S3Client,
    deployment: RegionClients,
    cloudFront: CloudFrontClient,
    releases: ReleaseArtifacts,
    logger: LoggerBuffer,
  ) {
    this.registryS3 = registryS3;
    this.deployment = deployment;
    this.cloudFront = cloudFront;
    this.releases   = releases;
    this.logger     = logger;
  }

  /** True when the bucket was advanced; false when it was not behind. */
  public async advanceIfStale(target: UiTarget): Promise<boolean> {
    const stale = await this.releases.findNewer(this.deployment.region, target.packageName, target.deployedVersion);
    if (!stale) {
      return false;
    }

    const location       = this.releases.locateUiBundle(this.deployment.region, target, stale.parsed);
    const distributionId = parseArn(target.arn).resourceId;

    try {
      this.logger.info('updating UI bucket', {
        bucketName:       target.bucketName,
        artifactBucket:   location.bucket,
        artifactKey:      location.key,
        newVersion:       stale.version,
        deploymentRegion: this.deployment.region,
      });

      const deployed     = await deployZipToPrefix(this.registryS3, {
        sourceBucket: location.bucket,
        sourceKey:    location.key,
        targetBucket: target.bucketName,
        targetPrefix: CONTENT_PREFIX,
      });
      const invalidation = await invalidateCloudFront(this.cloudFront, {
        distributionId,
        paths:           ['/*'],
        callerReference: `ui-update:${target.bucketName}:${stale.version}:${Date.now()}`,
      });
      await this.tagArtifactVersion(target, stale);

      this.logger.info('UI bucket updated', {
        bucketName: target.bucketName,
        distributionId,
        oldVersion:       target.deployedVersion,
        newVersion:       stale.version,
        filesUploaded:    deployed.uploaded,
        cacheInvalidated: invalidation.invalidated,
      });
      return true;
    } catch (thrown) {
      this.logger.error('failed to update UI bucket', {
        bucketName: target.bucketName,
        distributionId,
        error:      new CaughtError(thrown).message,
      });
      throw thrown;
    }
  }

  private async tagArtifactVersion(target: UiTarget, stale: StaleTarget): Promise<void> {
    await this.cloudFront.send(
      new TagResourceCommand({
        Resource: target.arn,
        Tags:     {
          Items: [{ Key: ServerlessInboxTagKeys.artifactVersion, Value: stale.version }],
        },
      }),
    );
  }
}
