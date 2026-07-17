/**
 * Standard Lambda code update path: UpdateFunctionCode + tag update.
 */

import { LambdaClient, UpdateFunctionCodeCommand } from '@aws-sdk/client-lambda';
import { buildArtifactKey } from '@serverlessinbox/artifact-registry';
import { LoggerBuffer } from '../shared/logger-buffer';
import { resolveStaleTarget } from './staleness';
import { requireEnv, artifactBucketName, bumpArtifactVersionTag } from './common';

/**
 * Update a Lambda function's code if a newer version is available.
 * On success, update the artifact-version tag and log via the provided buffer.
 * Returns true if an update occurred, false if no-op (not stale).
 * Integration testable: accepts region, lambdaArn, and derives pointer from env/registry.
 */
export async function advanceLambdaIfStale(
  region: string,
  lambdaArn: string,
  packageName: string,
  artifactName: string,
  deployedVersion: string,
  logger: LoggerBuffer,
): Promise<boolean> {
  const project = requireEnv('PROJECT');
  const bucketBase = process.env.ARTIFACT_BUCKET_BASE ?? 'mailbox-artifacts';

  // Check staleness
  const stale = await resolveStaleTarget(region, packageName, deployedVersion, logger);
  if (!stale) {
    return false;
  }

  const { pointer, parsed } = stale;

  // Build the artifact key for the new version and update the function.
  const artifactKey = buildArtifactKey('package', packageName, {
    type: 'release',
    version: parsed,
    objectName: `lambdas/${artifactName}.zip`,
    project,
  });
  const bucket = artifactBucketName(bucketBase, region);

  const lambdaClient = new LambdaClient({ region });
  try {
    logger.info('updating lambda code', { lambdaArn, artifactBucket: bucket, artifactKey, newVersion: pointer.version });
    await lambdaClient.send(
      new UpdateFunctionCodeCommand({
        FunctionName: lambdaArn,
        S3Bucket: bucket,
        S3Key: artifactKey,
      }),
    );

    // Update the artifact-version tag.
    await bumpArtifactVersionTag(lambdaClient, lambdaArn, pointer.version);

    logger.info('lambda updated', {
      lambdaArn,
      oldVersion: deployedVersion,
      newVersion: pointer.version,
    });

    logger.recordUpdate();
    return true;
  } catch (err: any) {
    logger.error('failed to update lambda', { lambdaArn, error: err.message });
    throw err;
  }
}
