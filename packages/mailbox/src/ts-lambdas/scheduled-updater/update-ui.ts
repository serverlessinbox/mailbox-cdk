/**
 * UI bundle update path: update S3 bucket directly with extracted bundle, invalidate CloudFront,
 * and update distribution tags via CloudFront TagResource.
 */

import {
  CloudFrontClient,
  TagResourceCommand,
} from '@aws-sdk/client-cloudfront';
import { buildArtifactKey } from '@serverlessinbox/artifact-registry';
import { deployZipToPrefix, normalizePrefix } from '../shared/ui-ops';
import { invalidateCloudFront } from '../shared/ui-cloudfront';
import { resolveStaleTarget } from './staleness';
import { requireEnv, artifactBucketName } from './common';

/**
 * Update a UI bucket's contents if a newer bundle version is available.
 * Extracts the bundle zip, uploads files to the target bucket, invalidates CloudFront,
 * and updates the distribution's artifact-version tag via CloudFront TagResource.
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
  distributionId: string,
): Promise<void> {
  const project = requireEnv('PROJECT');
  const bucketBase = process.env.ARTIFACT_BUCKET_BASE ?? 'mailbox-artifacts';
  const deploymentRegion = process.env.AWS_REGION || 'us-east-1';

  // Check staleness using deployment region (where the bundle artifact lives)
  const stale = await resolveStaleTarget(deploymentRegion, packageName, deployedVersion);
  if (!stale) {
    return;
  }

  const { pointer, parsed } = stale;

  // Resolve the bundle artifact key using deployment region
  const artifactKey = buildArtifactKey('package', packageName, {
    type: 'release',
    version: parsed,
    objectName: artifactName,
    project,
  });
  const bucket = artifactBucketName(bucketBase, deploymentRegion);

  try {
    console.log('updating UI bucket', { bucketName, artifactBucket: bucket, artifactKey, newVersion: pointer.version, deploymentRegion });

    // Extract and upload to bucket in deployment region
    const contentPrefix = normalizePrefix('content/', 'content/');
    const res = await deployZipToPrefix({
      sourceBucket: bucket,
      sourceKey: artifactKey,
      targetBucket: bucketName,
      targetPrefix: contentPrefix,
    });

    // Invalidate CloudFront
    const invalidationRes = await invalidateCloudFront({
      distributionId,
      paths: ['/*'],
      callerReference: `ui-update:${bucketName}:${pointer.version}:${Date.now()}`,
    });

    // Update the distribution's artifact-version tag via CloudFront TagResource
    const cloudFront = new CloudFrontClient({ region: deploymentRegion });
    const distributionArn = `arn:aws:cloudfront::${process.env.AWS_ACCOUNT_ID || '123456789012'}:distribution/${distributionId}`;

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

    console.log('UI bucket updated', {
      bucketName,
      distributionId,
      oldVersion: deployedVersion,
      newVersion: pointer.version,
      filesUploaded: res.uploaded,
      cacheInvalidated: invalidationRes.invalidated,
    });
  } catch (err: any) {
    console.error('failed to update UI bucket', { bucketName, distributionId, error: err.message });
    throw err;
  }
}
