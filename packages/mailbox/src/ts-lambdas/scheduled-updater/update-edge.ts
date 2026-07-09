/**
 * Edge Lambda update path: UpdateFunctionCode + PublishVersion + CloudFront repoint.
 */

import {
  LambdaClient,
  UpdateFunctionCodeCommand,
  PublishVersionCommand,
} from '@aws-sdk/client-lambda';
import {
  CloudFrontClient,
  ListDistributionsCommand,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  DistributionConfig,
} from '@aws-sdk/client-cloudfront';
import { buildArtifactKey } from '@serverlessinbox/artifact-registry';
import { resolveStaleTarget } from './staleness';
import { requireEnv, artifactBucketName, bumpArtifactVersionTag } from './common';

/**
 * Lambda@Edge association type from DistributionConfig.
 */
type LambdaAssociation = {
  EventType?: string;
  LambdaFunctionARN?: string;
  IncludeBody?: boolean;
};

/**
 * Helper to iterate all Lambda@Edge associations across DefaultCacheBehavior and CacheBehaviors.
 * Invokes callback for each association found.
 */
function forEachLambdaAssociation(
  distConfig: DistributionConfig,
  callback: (assoc: LambdaAssociation) => void,
): void {
  // DefaultCacheBehavior
  const defaultAssocs = distConfig.DefaultCacheBehavior?.LambdaFunctionAssociations?.Items ?? [];
  for (const assoc of defaultAssocs) {
    callback(assoc);
  }

  // Additional CacheBehaviors
  const cacheBehaviors = distConfig.CacheBehaviors?.Items ?? [];
  for (const behavior of cacheBehaviors) {
    const assocs = behavior.LambdaFunctionAssociations?.Items ?? [];
    for (const assoc of assocs) {
      callback(assoc);
    }
  }
}

/**
 * Strip version suffix from a Lambda ARN if present (format: arn:...:function:name:<version>).
 * Returns the versionless base ARN.
 */
function stripLambdaVersion(arn: string): string {
  // Remove trailing version number if present (:<digit>+)
  return arn.replace(/:\d+$/, '');
}

/**
 * Update an edge Lambda: UpdateFunctionCode, PublishVersion, and repoint CloudFront.
 * On success, update the lambda's artifact-version tag.
 */
export async function advanceEdgeLambdaIfStale(
  edgeLambdaArn: string,
  packageName: string,
  artifactName: string,
  deployedVersion: string,
): Promise<void> {
  const project = requireEnv('PROJECT');
  const bucketBase = process.env.ARTIFACT_BUCKET_BASE ?? 'mailbox-artifacts';
  const region = 'us-east-1'; // Edge lambdas are always us-east-1

  // Check staleness
  const stale = await resolveStaleTarget(region, packageName, deployedVersion);
  if (!stale) {
    return;
  }

  const { pointer, parsed } = stale;

  // Build the artifact key for the new version
  const artifactKey = buildArtifactKey('package', packageName, {
    type: 'release',
    version: parsed,
    objectName: `lambdas/${artifactName}.zip`,
    project,
  });
  const bucket = artifactBucketName(bucketBase, region);

  const lambdaClient = new LambdaClient({ region });
  const cfClient = new CloudFrontClient({ region });

  try {
    console.log('updating edge lambda code', { edgeLambdaArn, artifactBucket: bucket, artifactKey, newVersion: pointer.version });

    // 1. UpdateFunctionCode
    await lambdaClient.send(
      new UpdateFunctionCodeCommand({
        FunctionName: edgeLambdaArn,
        S3Bucket: bucket,
        S3Key: artifactKey,
      }),
    );

    // 2. PublishVersion → new numeric version
    const versionResp = await lambdaClient.send(
      new PublishVersionCommand({
        FunctionName: edgeLambdaArn,
      }),
    );
    const newVersionArn = versionResp.FunctionArn;
    if (!newVersionArn) {
      throw new Error('PublishVersion returned no FunctionArn');
    }

    // 3. Find CloudFront distribution associated with this lambda and update it
    const distResp = await cfClient.send(new ListDistributionsCommand({}));
    let targetDistributionId: string | undefined;
    let targetDistConfig: DistributionConfig | undefined;
    let targetDistETag: string | undefined;
    const versionlessArn = stripLambdaVersion(edgeLambdaArn);

    if (distResp.DistributionList?.Items) {
      for (const dist of distResp.DistributionList.Items) {
        if (!dist.Id || !dist.DomainName) continue;
        // Check if this distribution has a Lambda@Edge association for this lambda (match ARN only, all event types)
        let found = false;
        // Check DefaultCacheBehavior
        const defaultAssocs = dist.DefaultCacheBehavior?.LambdaFunctionAssociations?.Items ?? [];
        for (const assoc of defaultAssocs) {
          const assocArn = stripLambdaVersion(assoc.LambdaFunctionARN ?? '');
          if (assocArn === versionlessArn) {
            found = true;
            break;
          }
        }
        // Check additional CacheBehaviors
        if (!found) {
          const cacheBehaviors = dist.CacheBehaviors?.Items ?? [];
          for (const behavior of cacheBehaviors) {
            const assocs = behavior.LambdaFunctionAssociations?.Items ?? [];
            for (const assoc of assocs) {
              const assocArn = stripLambdaVersion(assoc.LambdaFunctionARN ?? '');
              if (assocArn === versionlessArn) {
                found = true;
                break;
              }
            }
            if (found) break;
          }
        }

        if (found) {
          targetDistributionId = dist.Id;
          // Fetch full config and ETag
          const cfgResp = await cfClient.send(
            new GetDistributionConfigCommand({ Id: targetDistributionId }),
          );
          targetDistConfig = cfgResp.DistributionConfig;
          targetDistETag = cfgResp.ETag;
          break;
        }
      }
    }

    if (!targetDistributionId || !targetDistConfig || !targetDistETag) {
      throw new Error(`No CloudFront distribution found for edge lambda ${edgeLambdaArn}`);
    }

    // 4. Update all lambda associations for this function (across all behaviors, all event types) with the new version ARN
    forEachLambdaAssociation(targetDistConfig, (assoc) => {
      const assocArn = stripLambdaVersion(assoc.LambdaFunctionARN ?? '');
      if (assocArn === versionlessArn) {
        assoc.LambdaFunctionARN = newVersionArn;
      }
    });

    // 5. UpdateDistribution with full config + ETag from GetDistributionConfig
    await cfClient.send(
      new UpdateDistributionCommand({
        Id: targetDistributionId,
        DistributionConfig: targetDistConfig,
        IfMatch: targetDistETag,
      }),
    );

    // 6. Tag the lambda to record the new artifact-version
    await bumpArtifactVersionTag(lambdaClient, edgeLambdaArn, pointer.version);

    console.log('edge lambda updated', {
      edgeLambdaArn,
      newVersionArn,
      distributionId: targetDistributionId,
      oldVersion: deployedVersion,
      newVersion: pointer.version,
    });
  } catch (err: any) {
    console.error('failed to update edge lambda', { edgeLambdaArn, error: err.message });
    throw err;
  }
}
