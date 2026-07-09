/**
 * Scheduled auto-updater Lambda handler (stack-self-update, Phase B).
 *
 * Discovers Lambdas tagged with the root-stack, compares their deployed versions against
 * track-scoped release pointers, and updates code for any that are stale within the granularity bound.
 * UI bundle refresh is deferred to a separate slice (stack-self-update Phase B.2).
 *
 * Triggered by EventBridge on a schedule (default 6h).
 * NOT wrapped in wrapHandler — plain async function returning void.
 */

import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
} from '@aws-sdk/client-resource-groups-tagging-api';
import {
  LambdaClient,
  UpdateFunctionCodeCommand,
  TagResourceCommand,
} from '@aws-sdk/client-lambda';
import { deriveTrack, buildArtifactKey, readReleasePointer } from '@serverlessinbox/artifact-registry';
import { gt as semverGt, valid as semverValid } from 'semver';

/** Environment variables supplied by the CDK wrapper (Step 7/8). */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`required environment variable ${name} is not set`);
  }
  return value;
}

/** Tenant ID / root stack name (all resources in this stack share this tag value). */
function getRootStackTag(): string {
  return requireEnv('ROOT_STACK_TAG_VALUE');
}

/** Convert ResourceGroupsTaggingAPI Tags array to a record for easier access. */
export function tagMapFrom(tags: Array<{ Key?: string; Value?: string }> | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!tags) return map;
  for (const tag of tags) {
    if (tag.Key && tag.Value) {
      map[tag.Key] = tag.Value;
    }
  }
  return map;
}

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
  const distTag = requireEnv('DIST_TAG');
  const granularity = requireEnv('GRANULARITY');
  const project = requireEnv('PROJECT');
  const bucketBase = process.env.ARTIFACT_BUCKET_BASE ?? 'mailbox-artifacts';

  // Derive the track from the deployed version.
  const myTrack = deriveTrack(deployedVersion, granularity as 'major' | 'minor');

  // Read the track-scoped pointer.
  const pointer = await readReleasePointer(packageName, distTag, region, {
    bucketBase,
    project,
    track: myTrack,
  });

  if (!pointer) {
    console.log('no pointer available', { packageName, distTag, track: myTrack });
    return;
  }

  // Guard against invalid versions: skip this target if either version isn't semver-valid.
  if (!semverValid(pointer.version) || !semverValid(deployedVersion)) {
    console.log('invalid version format, skipping', {
      lambdaArn,
      deployedVersion,
      candidateVersion: pointer.version,
      deployedVersionValid: semverValid(deployedVersion),
      candidateVersionValid: semverValid(pointer.version),
    });
    return;
  }

  // Check if the candidate version is strictly newer.
  if (!semverGt(pointer.version, deployedVersion)) {
    console.log('version is not newer', {
      lambdaArn,
      deployedVersion,
      candidateVersion: pointer.version,
    });
    return;
  }

  // Build the artifact key for the new version and update the function.
  const artifactKey = buildArtifactKey('package', packageName, {
    type: 'release',
    version: { version: pointer.version } as any, // The SemVer type is not critical here; we just need the string.
    objectName: `lambdas/${artifactName}.zip`,
    project,
  });
  const artifactBucket = `${bucketBase}-${region}`;

  const lambdaClient = new LambdaClient({ region });
  try {
    console.log('updating lambda code', { lambdaArn, artifactBucket, artifactKey, newVersion: pointer.version });
    await lambdaClient.send(
      new UpdateFunctionCodeCommand({
        FunctionName: lambdaArn,
        S3Bucket: artifactBucket,
        S3Key: artifactKey,
      }),
    );

    // Update the artifact-version tag.
    await lambdaClient.send(
      new TagResourceCommand({
        Resource: lambdaArn,
        Tags: { 'serverless-inbox:artifact-version': pointer.version },
      }),
    );

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


/**
 * Main handler: EventBridge-triggered, scans both regions for targets and updates stale ones.
 */
export const handler = async (): Promise<void> => {
  const rootStackTag = getRootStackTag();
  const regions = [process.env.AWS_REGION || 'us-east-1', 'us-east-1'];
  const uniqueRegions = Array.from(new Set(regions)); // Avoid scanning the same region twice if AWS_REGION = us-east-1.

  console.log('scheduled updater started', {
    rootStackTag,
    regions: uniqueRegions,
    granularity: process.env.GRANULARITY,
  });

  // Scan Lambda functions in both regions.
  for (const region of uniqueRegions) {
    const tagging = new ResourceGroupsTaggingAPIClient({ region });
    let nextToken: string | undefined;

    do {
      const response = await tagging.send(
        new GetResourcesCommand({
          TagFilters: [{ Key: 'serverless-inbox:root-stack', Values: [rootStackTag] }],
          ResourceTypeFilters: ['lambda:function'],
          PaginationToken: nextToken,
        }),
      );

      if (response.ResourceTagMappingList) {
        for (const resource of response.ResourceTagMappingList) {
          const arn = resource.ResourceARN;
          if (!arn) continue;

          const tags = tagMapFrom(resource.Tags);

          // Skip any resource tagged with the auto-update exclusion tag.
          if (tags['serverless-inbox:auto-update'] === 'exclude') {
            console.log('skipping auto-update-excluded resource', { arn });
            continue;
          }

          const pkg = tags['serverless-inbox:artifact-package'];
          const artifactName = tags['serverless-inbox:artifact-name'];
          const deployedVersion = tags['serverless-inbox:artifact-version'];

          if (!pkg || !artifactName || !deployedVersion) {
            console.debug('lambda missing artifact tags', { arn, pkg, artifactName, deployedVersion });
            continue;
          }

          try {
            await advanceLambdaIfStale(region, arn, pkg, artifactName, deployedVersion);
          } catch (err: any) {
            console.error('failed to check/update lambda', { arn, error: err.message });
            // Continue processing other targets.
          }
        }
      }

      nextToken = response.PaginationToken;
    } while (nextToken);
  }

  console.log('scheduled updater completed');
};
