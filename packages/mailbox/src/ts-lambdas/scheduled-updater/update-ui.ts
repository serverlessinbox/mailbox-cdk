/**
 * UI bundle update path: update S3 bucket directly with extracted bundle, invalidate CloudFront.
 */

import {
  S3Client,
  GetBucketTaggingCommand,
  PutBucketTaggingCommand,
} from '@aws-sdk/client-s3';
import { buildArtifactKey } from '@serverlessinbox/artifact-registry';
import { deployZipToPrefix, normalizePrefix } from '../shared/ui-ops';
import { invalidateCloudFront } from '../shared/ui-cloudfront';
import { resolveStaleTarget } from './staleness';
import { requireEnv, artifactBucketName } from './common';

/**
 * Update a UI bucket's contents if a newer bundle version is available.
 * Extracts the bundle zip, uploads files to the target bucket, invalidates CloudFront,
 * and updates the bucket's artifact-version tag.
 *
 * packageName and artifactName come from the bucket's tags.
 */
export async function advanceUiBucketIfStale(
  region: string,
  bucketName: string,
  packageName: string,
  artifactName: string,
  deployedVersion: string,
  distributionId: string,
): Promise<void> {
  const project = requireEnv('PROJECT');
  const bucketBase = process.env.ARTIFACT_BUCKET_BASE ?? 'mailbox-artifacts';

  // Check staleness
  const stale = await resolveStaleTarget(region, packageName, deployedVersion);
  if (!stale) {
    return;
  }

  const { pointer, parsed } = stale;

  // Resolve the bundle artifact key
  const artifactKey = buildArtifactKey('package', packageName, {
    type: 'release',
    version: parsed,
    objectName: artifactName,
    project,
  });
  const bucket = artifactBucketName(bucketBase, region);

  try {
    console.log('updating UI bucket', { bucketName, artifactBucket: bucket, artifactKey, newVersion: pointer.version });

    // Extract and upload
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

    // Update the bucket's artifact-version tag (read-modify-write to preserve other tags)
    const s3 = new S3Client({ region });
    const taggingResp = await s3.send(new GetBucketTaggingCommand({ Bucket: bucketName }));
    const existingTags = taggingResp.TagSet ?? [];

    // Build the updated tag set, preserving all existing tags and updating artifact-version
    const updatedTags = existingTags
      .filter((tag) => tag.Key !== 'serverless-inbox:artifact-version')
      .concat([{ Key: 'serverless-inbox:artifact-version', Value: pointer.version }]);

    await s3.send(
      new PutBucketTaggingCommand({
        Bucket: bucketName,
        Tagging: { TagSet: updatedTags },
      }),
    );

    console.log('UI bucket updated', {
      bucketName,
      oldVersion: deployedVersion,
      newVersion: pointer.version,
      filesUploaded: res.uploaded,
      cacheInvalidated: invalidationRes.invalidated,
    });
  } catch (err: any) {
    console.error('failed to update UI bucket', { bucketName, error: err.message });
    throw err;
  }
}
