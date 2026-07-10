/**
 * Scheduled auto-updater Lambda handler (stack-self-update, Phase B).
 *
 * Discovers resources tagged with the root-stack, compares their deployed versions against
 * track-scoped release pointers, and updates code/ui/edge for any that are stale within the granularity bound.
 *
 * Three update paths:
 * - code: UpdateFunctionCode on Lambda functions
 * - ui: Extract bundle zip, upload to S3 bucket, invalidate CloudFront
 * - edge: UpdateFunctionCode + PublishVersion + CloudFront repoint
 *
 * Triggered by EventBridge on a schedule (default 6h).
 * NOT wrapped in wrapHandler — plain async function returning void.
 */

import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { advanceLambdaIfStale } from './update-code';
import { advanceUiBucketIfStale } from './update-ui';
import { advanceEdgeLambdaIfStale } from './update-edge';
import { requireEnv, tagMapFrom } from './common';

/** Tenant ID / root stack name (all resources in this stack share this tag value). */
function getRootStackTag(): string {
  return requireEnv('ROOT_STACK_TAG_VALUE');
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

  // Scan Lambda functions and CloudFront distributions in both regions.
  for (const region of uniqueRegions) {
    const tagging = new ResourceGroupsTaggingAPIClient({ region });
    let nextToken: string | undefined;

    do {
      const response = await tagging.send(
        new GetResourcesCommand({
          TagFilters: [{ Key: 'serverless-inbox:root-stack', Values: [rootStackTag] }],
          ResourceTypeFilters: ['lambda:function', 'cloudfront:distribution'],
          PaginationToken: nextToken,
        }),
      );

      if (response.ResourceTagMappingList) {
        for (const resource of response.ResourceTagMappingList) {
          const arn = resource.ResourceARN;
          if (!arn) continue;

          const tags = tagMapFrom(resource.Tags);
          const resourceType = arn.split(':')[2]; // Extract service type from ARN (position 2 = s3|lambda|etc)

          // Read auto-update type
          const autoUpdateType = tags['serverless-inbox:auto-update-type'] ?? 'none';
          const pkg = tags['serverless-inbox:artifact-package'];
          const artifactName = tags['serverless-inbox:artifact-name'];
          const deployedVersion = tags['serverless-inbox:artifact-version'];

          if (!pkg || !artifactName || !deployedVersion) {
            console.debug('resource missing artifact tags', { arn, resourceType, pkg, artifactName, deployedVersion });
            continue;
          }

          if (autoUpdateType === 'none') {
            console.debug('skipping auto-update-type=none', { arn });
            continue;
          }

          try {
            // Route by resource type and auto-update-type
            if (resourceType === 'cloudfront') {
              // CloudFront distribution: only UI type is supported
              if (autoUpdateType === 'ui') {
                const bucketName = tags['serverless-inbox:bucket-name'];
                if (!bucketName) {
                  console.debug('UI distribution missing bucket-name tag', { arn });
                  continue;
                }
                await advanceUiBucketIfStale(process.env.AWS_REGION || 'us-east-1', bucketName, pkg, artifactName, deployedVersion, arn);
              } else {
                console.debug('unsupported auto-update-type for CloudFront distribution', { arn, type: autoUpdateType });
              }
            } else if (resourceType === 'lambda') {
              // Lambda function: code or edge types
              switch (autoUpdateType) {
                case 'code':
                  await advanceLambdaIfStale(region, arn, pkg, artifactName, deployedVersion);
                  break;
                case 'edge':
                  if (region === 'us-east-1') {
                    await advanceEdgeLambdaIfStale(arn, pkg, artifactName, deployedVersion);
                  } else {
                    console.debug('skipping edge update in non-us-east-1 region', { arn, region });
                  }
                  break;
                default:
                  console.debug('unknown auto-update-type for lambda', { arn, type: autoUpdateType });
              }
            } else {
              console.debug('unknown resource type', { arn, resourceType });
            }
          } catch (err: any) {
            console.error('failed to update resource', { arn, error: err.message });
            // Continue processing other targets.
          }
        }
      }

      nextToken = response.PaginationToken;
    } while (nextToken);
  }

  console.log('scheduled updater completed');
};
