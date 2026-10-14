import {
  GetResourcesCommand,
  type ResourceTagMapping,
  type Tag,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { CaughtError, parseArn, ServerlessInboxTagKeys, type LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { LambdaTarget, UiTarget } from './artifact-target';
import type { Config } from './config';
import type { EdgeLambdaUpdater } from './edge-lambda-updater';
import type { LambdaCodeUpdater } from './lambda-code-updater';
import type { UiBucketUpdater } from './ui-bucket-updater';
import { EDGE_REGION, type RegionClients, type UpdaterClients } from './updater-clients';
import {
  toArtifactName,
  toArtifactPackageName,
  toArtifactVersion,
  toContentBucketName,
  toDistributionArn,
  toLambdaFunctionArn,
} from './updater-identifiers';

/** One page of the resources that carry the root stack tag, and the token of the next page when there is one. */
interface TaggedResourcePage {
  readonly resources: ResourceTagMapping[];
  readonly nextToken: string | undefined;
}

/**
 * A managed resource that opted in to automatic updates and carries the tags that say what it was deployed
 * from. Its values are as the tags hold them, not yet checked to be of the kinds the updaters take.
 */
interface UpdatableResource {
  readonly arn: string;
  readonly service: string | undefined;
  readonly autoUpdateType: string;
  readonly packageName: string;
  readonly artifactName: string;
  readonly deployedVersion: string;
  readonly bucketName: string | undefined;
}

/**
 * One scan of the stack's tagged Lambda functions and CloudFront distributions in the deployment region and
 * the edge region, advancing each one that opted in to the update path its auto-update-type names. A resource
 * whose update fails is logged and does not stop the scan of the others.
 */
export class UpdateCycle {
  private readonly config: Config;
  private readonly clients: UpdaterClients;
  private readonly logger: LoggerBuffer;
  private readonly codeUpdater: LambdaCodeUpdater;
  private readonly edgeUpdater: EdgeLambdaUpdater;
  private readonly uiUpdater: UiBucketUpdater;

  constructor(
    config: Config,
    clients: UpdaterClients,
    logger: LoggerBuffer,
    codeUpdater: LambdaCodeUpdater,
    edgeUpdater: EdgeLambdaUpdater,
    uiUpdater: UiBucketUpdater,
  ) {
    this.config = config;
    this.clients = clients;
    this.logger = logger;
    this.codeUpdater = codeUpdater;
    this.edgeUpdater = edgeUpdater;
    this.uiUpdater = uiUpdater;
  }

  /** Throws when the scan itself fails; a failed update of one resource is logged and the scan goes on. */
  public async run(): Promise<void> {
    try {
      const scanTargets = this.beginCycle();
      for (const scan of scanTargets) {
        await this.scanRegion(scan);
      }
      this.logger.info('artifact update cycle completed');
    } catch (thrown) {
      this.recordFailedCycle(thrown);
      throw thrown;
    }
  }

  private beginCycle(): RegionClients[] {
    const { deployment, edge } = this.clients;
    // The deployment region is scanned once when it is the edge region.
    const scanTargets = edge === deployment ? [deployment] : [deployment, edge];

    this.logger.info('artifact update cycle started', {
      rootStackTag: this.config.rootStackTagValue,
      regions: scanTargets.map((target) => target.region),
      granularity: this.config.granularity,
    });
    return scanTargets;
  }

  private async scanRegion(scan: RegionClients): Promise<void> {
    let nextToken: string | undefined;

    do {
      const page = await this.fetchTaggedResources(scan, nextToken);
      for (const mapping of page.resources) {
        await this.updateResource(scan, mapping);
      }
      nextToken = page.nextToken;
    } while (nextToken);
  }

  private async fetchTaggedResources(scan: RegionClients, paginationToken: string | undefined): Promise<TaggedResourcePage> {
    const response = await scan.tagging.send(
      new GetResourcesCommand({
        TagFilters: [{ Key: ServerlessInboxTagKeys.rootStack, Values: [this.config.rootStackTagValue] }],
        ResourceTypeFilters: ['lambda:function', 'cloudfront:distribution'],
        PaginationToken: paginationToken,
      }),
    );
    return { resources: response.ResourceTagMappingList ?? [], nextToken: response.PaginationToken };
  }

  private async updateResource(scan: RegionClients, mapping: ResourceTagMapping): Promise<void> {
    const resource = this.readUpdatableResource(mapping);
    if (!resource) {
      return;
    }

    try {
      await this.advance(scan, resource);
    } catch (thrown) {
      this.recordFailedResource(resource.arn, thrown);
    }
  }

  /** The resource when it opted in to updates and is fully tagged; otherwise undefined, with the reason logged. */
  private readUpdatableResource(mapping: ResourceTagMapping): UpdatableResource | undefined {
    const arn = mapping.ResourceARN;
    if (!arn) {
      return undefined;
    }

    const tags = this.tagMapFrom(mapping.Tags);
    const service = this.serviceOf(arn);
    const autoUpdateType = tags[ServerlessInboxTagKeys.autoUpdateType] ?? 'none';
    const packageName = tags[ServerlessInboxTagKeys.artifactPackage];
    const artifactName = tags[ServerlessInboxTagKeys.artifactName];
    const deployedVersion = tags[ServerlessInboxTagKeys.artifactVersion];

    // A resource that did not opt in is skipped before its artifact tags are checked, since it needs none.
    if (autoUpdateType === 'none') {
      this.logger.debug('skipping auto-update-type=none', { arn });
      return undefined;
    }

    if (!packageName || !artifactName || !deployedVersion) {
      this.logger.warn('resource missing artifact tags', {
        arn,
        resourceType: service,
        pkg: packageName,
        artifactName,
        deployedVersion,
      });
      return undefined;
    }

    return {
      arn,
      service,
      autoUpdateType,
      packageName,
      artifactName,
      deployedVersion,
      bucketName: tags[ServerlessInboxTagKeys.bucketName],
    };
  }

  private async advance(scan: RegionClients, resource: UpdatableResource): Promise<void> {
    if (resource.service === 'cloudfront') {
      await this.advanceDistribution(resource);
      return;
    }
    if (resource.service === 'lambda') {
      await this.advanceFunction(scan, resource);
      return;
    }
    this.logger.debug('unknown resource type', { arn: resource.arn, resourceType: resource.service });
  }

  /** Only a distribution in front of a UI bucket is updated. */
  private async advanceDistribution(resource: UpdatableResource): Promise<void> {
    if (resource.autoUpdateType !== 'ui') {
      this.logger.debug('unsupported auto-update-type for CloudFront distribution', {
        arn: resource.arn,
        type: resource.autoUpdateType,
      });
      return;
    }

    if (!resource.bucketName) {
      this.logger.debug('UI distribution missing bucket-name tag', { arn: resource.arn });
      return;
    }

    await this.uiUpdater.advanceIfStale(this.uiTarget(resource, resource.bucketName));
  }

  private async advanceFunction(scan: RegionClients, resource: UpdatableResource): Promise<void> {
    switch (resource.autoUpdateType) {
      case 'code':
        await this.codeUpdater.advanceIfStale(scan, this.lambdaTarget(resource));
        return;
      case 'edge':
        await this.advanceEdgeFunction(scan, resource);
        return;
      default:
        this.logger.debug('unknown auto-update-type for lambda', { arn: resource.arn, type: resource.autoUpdateType });
    }
  }

  /** Lambda@Edge functions live in the edge region only. */
  private async advanceEdgeFunction(scan: RegionClients, resource: UpdatableResource): Promise<void> {
    if (scan.region !== EDGE_REGION) {
      this.logger.debug('skipping edge update in non-us-east-1 region', { arn: resource.arn, region: scan.region });
      return;
    }
    await this.edgeUpdater.advanceIfStale(this.lambdaTarget(resource));
  }

  private lambdaTarget(resource: UpdatableResource): LambdaTarget {
    return {
      arn: toLambdaFunctionArn(resource.arn),
      packageName: toArtifactPackageName(resource.packageName),
      artifactName: toArtifactName(resource.artifactName),
      deployedVersion: toArtifactVersion(resource.deployedVersion),
    };
  }

  private uiTarget(resource: UpdatableResource, bucketName: string): UiTarget {
    return {
      arn: toDistributionArn(resource.arn),
      bucketName: toContentBucketName(bucketName),
      packageName: toArtifactPackageName(resource.packageName),
      artifactName: toArtifactName(resource.artifactName),
      deployedVersion: toArtifactVersion(resource.deployedVersion),
    };
  }

  /** The service of the ARN, or undefined for an ARN that is malformed, which is then not a resource of a managed service. */
  private serviceOf(arn: string): string | undefined {
    try {
      return parseArn(arn).service;
    } catch {
      return undefined;
    }
  }

  private tagMapFrom(tags: Tag[] | undefined): Record<string, string> {
    const map: Record<string, string> = {};
    for (const tag of tags ?? []) {
      if (tag.Key && tag.Value) {
        map[tag.Key] = tag.Value;
      }
    }
    return map;
  }

  private recordFailedResource(arn: string, thrown: unknown): void {
    this.logger.error('failed to update resource', { arn, error: new CaughtError(thrown).message });
  }

  private recordFailedCycle(thrown: unknown): void {
    this.logger.error('artifact update cycle failed', { error: new CaughtError(thrown).message });
  }
}
