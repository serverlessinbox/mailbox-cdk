/**
 * Standard Lambda code update path: UpdateFunctionCode + tag update.
 */

import { LambdaClient, UpdateFunctionCodeCommand } from '@aws-sdk/client-lambda';
import { buildArtifactKey } from '@serverlessinbox/artifact-registry';
import { resolveStaleTarget } from './staleness';
import { requireEnv, artifactBucketName, bumpArtifactVersionTag } from './common';

/**
 * Update a Lambda function's code if a newer version is available.
 * On success, update the artifact-version tag.
 * Integration testable: accepts region, lambdaArn, and derives pointer from env/registry.
 */
export async function advanceLambdaIfStale(
  region: string,
  lambdaArn: string,
  packageName: string,
  artifactName: string,
  deployedVersion: string,
): Promise<void> {
  const project = requireEnv('PROJECT');
  const bucketBase = process.env.ARTIFACT_BUCKET_BASE ?? 'mailbox-artifacts';

  // Check staleness
  const stale = await resolveStaleTarget(region, packageName, deployedVersion);
  if (!stale) {
    return;
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
    console.log('updating lambda code', { lambdaArn, artifactBucket: bucket, artifactKey, newVersion: pointer.version });
    await lambdaClient.send(
      new UpdateFunctionCodeCommand({
        FunctionName: lambdaArn,
        S3Bucket: bucket,
        S3Key: artifactKey,
      }),
    );

    // Update the artifact-version tag.
    await bumpArtifactVersionTag(lambdaClient, lambdaArn, pointer.version);

    console.log('lambda updated', {
      lambdaArn,
      oldVersion: deployedVersion,
      newVersion: pointer.version,
    });
  } catch (err: any) {
    console.error('failed to update lambda', { lambdaArn, error: err.message });
    throw err;
  }
}
