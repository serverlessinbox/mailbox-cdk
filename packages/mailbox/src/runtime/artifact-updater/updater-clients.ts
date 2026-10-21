import type { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import type { LambdaClient }     from '@aws-sdk/client-lambda';
import {
  GetResourcesCommand,
  type ResourceGroupsTaggingAPIClient,
  type ResourceTagMapping,
} from '@aws-sdk/client-resource-groups-tagging-api';
import type { S3Client }                                 from '@aws-sdk/client-s3';
import { ServerlessInboxTagKeys, toRegion, type Region } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/** Lambda@Edge functions and the CloudFront API live in this region regardless of the deployment region. */
export const EDGE_REGION = toRegion('us-east-1');

/** The clients the updater needs in one region it scans for artifacts. */
export interface RegionClients {
  readonly region: Region;
  readonly lambda: LambdaClient;
  readonly tagging: ResourceGroupsTaggingAPIClient;
}

/**
 * Every AWS client the artifact updater uses, built once by the entry point and handed down.
 * Modules below the entry point never construct a client of their own.
 */
export interface UpdaterClients {
  /** Reads release pointers and artifacts from any region (follows redirects); also writes UI content in the deployment region. */
  readonly registryS3: S3Client;
  readonly deployment: RegionClients;
  /** The same instance as `deployment` when the deployment region is the edge region. */
  readonly edge: RegionClients;
  readonly cloudFront: CloudFrontClient;
}

/**
 * Finds the resources that belong to a root stack through the tagging API. A resource that carries a
 * `root-stack-id` tag belongs to the stack whose guid it names; a resource without one belongs to the stack
 * whose name its `root-stack` tag holds. The two sets are disjoint, so a resource is never returned twice.
 */
export class RootStackResources {
  constructor(
    private readonly rootStackName: string,
    private readonly rootStackId: string,
  ) {}

  /** Every resource of the given types in the region of `tagging` that belong to the root stack. */
  public async find(tagging: ResourceGroupsTaggingAPIClient, resourceTypeFilters: string[]): Promise<ResourceTagMapping[]> {
    const taggedWithId   = await this.listTagged(tagging, ServerlessInboxTagKeys.rootStackId, this.rootStackId, resourceTypeFilters);
    const taggedWithName = await this.listTagged(tagging, ServerlessInboxTagKeys.rootStack, this.rootStackName, resourceTypeFilters);
    return [...taggedWithId, ...taggedWithName.filter((mapping) => !this.hasIdTag(mapping))];
  }

  private async listTagged(
    tagging: ResourceGroupsTaggingAPIClient,
    tagKey: string,
    tagValue: string,
    resourceTypeFilters: string[],
  ): Promise<ResourceTagMapping[]> {
    const mappings: ResourceTagMapping[] = [];
    let paginationToken: string | undefined;

    do {
      const page = await tagging.send(
        new GetResourcesCommand({
          TagFilters: [{ Key: tagKey, Values: [tagValue] }],
          ResourceTypeFilters: resourceTypeFilters,
          PaginationToken: paginationToken,
        }),
      );
      mappings.push(...(page.ResourceTagMappingList ?? []));
      paginationToken = page.PaginationToken || undefined;
    } while (paginationToken);

    return mappings;
  }

  private hasIdTag(mapping: ResourceTagMapping): boolean {
    return (mapping.Tags ?? []).some((tag) => tag.Key === ServerlessInboxTagKeys.rootStackId);
  }
}
