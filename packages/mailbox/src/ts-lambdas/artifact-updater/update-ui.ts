/**
 * UI bundle update path: update S3 bucket directly with extracted bundle, invalidate CloudFront,
 * and update distribution tags via CloudFront TagResource.
 */

import {
  CloudFrontClient,
  TagResourceCommand,
} from '@aws-sdk/client-cloudfront';
import { S3Client } from '@aws-sdk/client-s3';
import { buildArtifactKey } from '@serverlessinbox/artifact-registry';
import { LoggerBuffer, deployZipToPrefix, normalizePrefix, invalidateCloudFront } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { resolveStaleTarget } from './staleness';
import type { UpdaterTargetConfig } from './common';
import { artifactBucketName } from './common';

/**
 * Update a UI bucket's contents if a newer bundle version is available.
 * Extracts the bundle zip, uploads files to the target bucket, invalidates CloudFront,
 * and updates the distribution's artifact-version tag via CloudFront TagResource.
 * Returns true if an update occurred, false if no-op (not stale).
 *
 * packageName and artifactName come from the distribution's tags.
 * Uses process.env.AWS_REGION (deployment region) for artifact resolution, not the scan region.
 */
export async function advanceUiBucketIfStale(
  _scanRegion: string,
  bucketName: string,
  packageName: string,
  artifactName: string,
  deployedVersion: string,
  distributionArn: string,
  logger: LoggerBuffer,
  config: UpdaterTargetConfig,
): Promise<boolean> {
  const { project, artifactBucketBase } = config;
  const deploymentRegion = process.env.AWS_REGION || 'us-east-1';

  // Check staleness using deployment region (where the bundle artifact lives)
  const stale = await resolveStaleTarget(deploymentRegion, packageName, deployedVersion, logger, config);
  if (!stale) {
    return false;
  }

  const { pointer, parsed } = stale;

  // Resolve the bundle artifact key using deployment region
  const artifactKey = buildArtifactKey('package', packageName, {
    type: 'release',
    version: parsed,
    objectName: artifactName,
    project,
  });
  const bucket = artifactBucketName(artifactBucketBase, deploymentRegion);

  try {
    logger.info('updating UI bucket', { bucketName, artifactBucket: bucket, artifactKey, newVersion: pointer.version, deploymentRegion });

    // Extract distribution ID from ARN for invalidation and logging
    // ARN format: arn:aws:cloudfront::ACCOUNT:distribution/DISTRIBUTION_ID
    const distributionId = distributionArn.split('/')[1];

    // Extract and upload to bucket in deployment region
    const contentPrefix = normalizePrefix('content/', 'content/');
    const s3 = new S3Client({ region: deploymentRegion });
    const res = await deployZipToPrefix(s3, {
      sourceBucket: bucket,
      sourceKey: artifactKey,
      targetBucket: bucketName,
      targetPrefix: contentPrefix,
    });

    // Update the distribution's artifact-version tag via CloudFront TagResource
    const cloudFront = new CloudFrontClient({ region: deploymentRegion });

    // Invalidate CloudFront
    const invalidationRes = await invalidateCloudFront(cloudFront, {
      distributionId,
      paths: ['/*'],
      callerReference: `ui-update:${bucketName}:${pointer.version}:${Date.now()}`,
    });

    await cloudFront.send(
      new TagResourceCommand({
        Resource: distributionArn,
        Tags: {
          Items: [
            { Key: 'serverless-inbox:artifact-version', Value: pointer.version },
          ],
        },
      }),
    );

    logger.info('UI bucket updated', {
      bucketName,
      distributionId,
      oldVersion: deployedVersion,
      newVersion: pointer.version,
      filesUploaded: res.uploaded,
      cacheInvalidated: invalidationRes.invalidated,
    });

    logger.recordUpdate();
    return true;
  } catch (err: any) {
    logger.error('failed to update UI bucket', { bucketName, distributionId: distributionArn.split('/')[1], error: err.message });
    throw err;
  }
}
