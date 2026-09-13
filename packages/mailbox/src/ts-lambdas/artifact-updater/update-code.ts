/**
 * Standard Lambda code update path: UpdateFunctionCode + tag update.
 */

import { LambdaClient, UpdateFunctionCodeCommand } from '@aws-sdk/client-lambda';
import { buildArtifactKey } from '@serverlessinbox/artifact-registry';
import { parse as semverParse } from 'semver';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { resolveStaleTarget } from './staleness';
import type { UpdaterTargetConfig } from './common';
import { artifactBucketName, bumpArtifactVersionTag, waitForFunctionCodeUpdateSettled } from './common';
import { invokeSmokeTest } from './smoke-test';

/**
 * Update a Lambda function's code if a newer version is available.
 * Tests the update via smoke test; if successful, bumps the artifact-version tag.
 * On failure, rolls back to the deployed version and does not bump the tag.
 * Returns true if an update occurred (including unprobeable cases that are bumped), false on rollback.
 * Integration testable: accepts region, lambdaArn, and derives pointer from env/registry.
 */
export async function advanceLambdaIfStale(
  region: string,
  lambdaArn: string,
  packageName: string,
  artifactName: string,
  deployedVersion: string,
  logger: LoggerBuffer,
  config: UpdaterTargetConfig,
): Promise<boolean> {
  const { project, artifactBucketBase } = config;

  // Check staleness
  const stale = await resolveStaleTarget(region, packageName, deployedVersion, logger, config);
  if (!stale) {
    return false;
  }

  const { pointer, parsed } = stale;

  // Build the artifact key for the new version
  const artifactKey = buildArtifactKey('package', packageName, {
    type: 'release',
    version: parsed,
    objectName: `lambdas/${artifactName}.zip`,
    project,
  });
  const bucket = artifactBucketName(artifactBucketBase, region);

  const lambdaClient = new LambdaClient({ region });
  try {
    logger.info('updating lambda code', { lambdaArn, artifactBucket: bucket, artifactKey, newVersion: pointer.version });

    // 1. UpdateFunctionCode with the new artifact
    await lambdaClient.send(
      new UpdateFunctionCodeCommand({
        FunctionName: lambdaArn,
        S3Bucket: bucket,
        S3Key: artifactKey,
      }),
    );

    // 2. Wait for the code update to settle
    await waitForFunctionCodeUpdateSettled(lambdaClient, lambdaArn);

    // 3. Run smoke test to verify the function initialized successfully
    const verdict = await invokeSmokeTest(lambdaClient, lambdaArn, logger);

    // 4. Handle verdict
    if (verdict === 'pass') {
      // Update succeeded and function is healthy
      await bumpArtifactVersionTag(lambdaClient, lambdaArn, pointer.version);
      logger.info('lambda updated', {
        lambdaArn,
        oldVersion: deployedVersion,
        newVersion: pointer.version,
      });
      logger.recordUpdate();
      return true;
    }

    if (verdict === 'unprobeable') {
      // Update succeeded but we couldn't verify it — proceed anyway (network issue, permissions, etc.)
      // Log at warn level to signal the gap in verification, but don't block the update
      await bumpArtifactVersionTag(lambdaClient, lambdaArn, pointer.version);
      logger.warn('lambda updated but smoke test unprobeable', {
        lambdaArn,
        oldVersion: deployedVersion,
        newVersion: pointer.version,
      });
      logger.recordUpdate();
      return true;
    }

    // verdict === 'fail': function failed to initialize, rollback required
    logger.error('smoke test failed, rolling back', {
      lambdaArn,
      failedVersion: pointer.version,
      deployedVersion,
    });

    // Rebuild the old artifact key for rollback by parsing the deployed version
    const oldParsed = semverParse(deployedVersion);
    if (!oldParsed) {
      throw new Error(`Unable to parse deployed version ${deployedVersion} for rollback`);
    }
    const oldArtifactKey = buildArtifactKey('package', packageName, {
      type: 'release',
      version: oldParsed,
      objectName: `lambdas/${artifactName}.zip`,
      project,
    });

    // Rollback: UpdateFunctionCode to the old artifact
    logger.info('rolling back lambda to deployed version', {
      lambdaArn,
      oldArtifactBucket: bucket,
      oldArtifactKey,
      version: deployedVersion,
    });

    await lambdaClient.send(
      new UpdateFunctionCodeCommand({
        FunctionName: lambdaArn,
        S3Bucket: bucket,
        S3Key: oldArtifactKey,
      }),
    );

    // Rollback settle-wait (best effort; log any error but don't throw)
    try {
      await waitForFunctionCodeUpdateSettled(lambdaClient, lambdaArn);
      logger.info('rollback settled successfully', { lambdaArn, version: deployedVersion });
    } catch (rollbackErr: any) {
      logger.error('rollback settle-wait failed', {
        lambdaArn,
        error: rollbackErr.message,
        note: 'function may still be on failed code; manual intervention may be needed',
      });
    }

    // No tag write on failure — tag still reads the deployed version, keeping tag and code in sync
    return false;
  } catch (err: any) {
    logger.error('failed to update lambda', { lambdaArn, error: err.message });
    throw err;
  }
}
