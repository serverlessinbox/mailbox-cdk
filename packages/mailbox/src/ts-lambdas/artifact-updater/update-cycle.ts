import { GetResourcesCommand } from '@aws-sdk/client-resource-groups-tagging-api';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { Config } from './config';
import { EDGE_REGION, type UpdaterClients } from './updater-clients';
import { advanceLambdaIfStale } from './update-code';
import { advanceUiBucketIfStale } from './update-ui';
import { advanceEdgeLambdaIfStale } from './update-edge';
import { tagMapFrom } from './common';

/**
 * Run the artifact update cycle: scan for stale resources and update them.
 * Implements buffered logging: only logs when updates occur or errors happen.
 * Scans both regions and filters by registered packages.
 */
export async function runUpdateCycle(config: Config, clients: UpdaterClients): Promise<void> {
  const logger = new LoggerBuffer(config.serviceName, config.logLevel);

  try {
    // Extract config needed for update functions
    const updateConfig = {
      distTag: config.distTag,
      granularity: config.granularity,
      project: config.project,
      artifactBucketBase: config.artifactBucketBase,
    };
    // Avoid scanning the same region twice when the deployment region is the edge region.
    const scanTargets = clients.edge === clients.deployment ? [clients.deployment] : [clients.deployment, clients.edge];

    logger.info('artifact update cycle started', {
      rootStackTag: config.rootStackTagValue,
      regions: scanTargets.map((target) => target.region),
      granularity: config.granularity,
    });

    // Scan Lambda functions and CloudFront distributions in both regions.
    for (const scan of scanTargets) {
      const tagging = scan.tagging;
      let nextToken: string | undefined;

      do {
        const response = await tagging.send(
          new GetResourcesCommand({
            TagFilters: [{ Key: 'serverless-inbox:root-stack', Values: [config.rootStackTagValue] }],
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

            if (autoUpdateType === 'none') {
              logger.debug('skipping auto-update-type=none', { arn });
              continue;
            }

            if (!pkg || !artifactName || !deployedVersion) {
              logger.warn('resource missing artifact tags', { arn, resourceType, pkg, artifactName, deployedVersion });
              continue;
            }

            try {
              // Route by resource type and auto-update-type
              if (resourceType === 'cloudfront') {
                // CloudFront distribution: only UI type is supported
                if (autoUpdateType === 'ui') {
                  const bucketName = tags['serverless-inbox:bucket-name'];
                  if (!bucketName) {
                    logger.debug('UI distribution missing bucket-name tag', { arn });
                    continue;
                  }
                  await advanceUiBucketIfStale(clients, bucketName, pkg, artifactName, deployedVersion, arn, logger, updateConfig);
                } else {
                  logger.debug('unsupported auto-update-type for CloudFront distribution', { arn, type: autoUpdateType });
                }
              } else if (resourceType === 'lambda') {
                // Lambda function: code or edge types
                switch (autoUpdateType) {
                  case 'code':
                    await advanceLambdaIfStale(clients, scan, arn, pkg, artifactName, deployedVersion, logger, updateConfig);
                    break;
                  case 'edge':
                    if (scan.region === EDGE_REGION) {
                      await advanceEdgeLambdaIfStale(clients, arn, pkg, artifactName, deployedVersion, logger, updateConfig);
                    } else {
                      logger.debug('skipping edge update in non-us-east-1 region', { arn, region: scan.region });
                    }
                    break;
                  default:
                    logger.debug('unknown auto-update-type for lambda', { arn, type: autoUpdateType });
                }
              } else {
                logger.debug('unknown resource type', { arn, resourceType });
              }
            } catch (err: any) {
              logger.error('failed to update resource', { arn, error: err.message });
              // Continue processing other targets.
            }
          }
        }

        nextToken = response.PaginationToken;
      } while (nextToken);
    }

    logger.info('artifact update cycle completed');
  } catch (err: any) {
    logger.error('artifact update cycle failed', { error: err.message });
    throw err;
  } finally {
    // Flush buffered logs only if there were updates or errors.
    if (logger.shouldFlush()) {
      logger.flush();
    }
  }
}
