import type { ResourceTagMapping, Tag }                                                  from '@aws-sdk/client-resource-groups-tagging-api';
import { CaughtError, parseArn, ServerlessInboxTagKeys, type LoggerBuffer }              from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { LambdaTarget, UiTarget }                                                   from './artifact-target';
import type { Config }                                                                   from './config';
import type { EdgeLambdaUpdater }                                                        from './edge-lambda-updater';
import type { LambdaCodeUpdater }                                                        from './lambda-code/lambda-code-updater';
import type { UiBucketUpdater }                                                          from './ui-bucket-updater';
import { EDGE_REGION, type RegionClients, type RootStackResources, type UpdaterClients } from './updater-clients';
import {
  toArtifactName,
  toArtifactPackageName,
  toArtifactVersion,
  toContentBucketName,
  toDistributionArn,
  toLambdaFunctionArn,
} from './updater-identifiers';

/**
 * A managed resource that opted in to automatic updates and carries the tags that say what it was deployed
 * from. Its values are as the tags hold them, not yet checked to be of the kinds the updaters take.
 */
interface UpdatableResource {
  readonly arn:             string;
  readonly service:         string | undefined;
  readonly autoUpdateType:  string;
  readonly packageName:     string;
  readonly artifactName:    string;
  readonly deployedVersion: string;
  readonly bucketName:      string | undefined;
}

/**
 * One scan of the Lambda functions and CloudFront distributions the root stack owns in the deployment region
 * and the edge region, advancing each one that opted in to the update path its auto-update-type names. A resource
 * whose update fails is logged and does not stop the scan of the others; the cycle as a whole fails only when
 * every resource it tried failed.
 */
export class UpdateCycle {
  private readonly config: Config;
  private readonly clients: UpdaterClients;
  private readonly rootStackResources: RootStackResources;
  private readonly logger: LoggerBuffer;
  private readonly codeUpdater: LambdaCodeUpdater;
  private readonly edgeUpdater: EdgeLambdaUpdater;
  private readonly uiUpdater: UiBucketUpdater;
  private updatesAttempted = 0;
  private updatesFailed = 0;

  constructor(
    config: Config,
    clients: UpdaterClients,
    rootStackResources: RootStackResources,
    logger: LoggerBuffer,
    codeUpdater: LambdaCodeUpdater,
    edgeUpdater: EdgeLambdaUpdater,
    uiUpdater: UiBucketUpdater,
  ) {
    this.config             = config;
    this.clients            = clients;
    this.rootStackResources = rootStackResources;
    this.logger             = logger;
    this.codeUpdater        = codeUpdater;
    this.edgeUpdater        = edgeUpdater;
    this.uiUpdater          = uiUpdater;
  }

  /**
   * Throws when the scan itself fails, or when every resource it tried to update failed. A failed update of
   * one resource among others is logged and the scan goes on; a cycle with nothing to update succeeds.
   */
  public async run(): Promise<void> {
    try {
      const scanTargets = this.beginCycle();
      for (const scan of scanTargets) {
        await this.scanRegion(scan);
      }
      this.concludeCycle();
    } catch (thrown) {
      this.recordFailedCycle(thrown);
      throw thrown;
    }
  }

  private beginCycle(): RegionClients[] {
    const { deployment, edge } = this.clients;
    // The deployment region is scanned once when it is the edge region.
    const scanTargets     = edge === deployment ? [deployment] : [deployment, edge];
    this.updatesAttempted = 0;
    this.updatesFailed    = 0;

    this.logger.info('artifact update cycle started', {
      rootStackTag: this.config.rootStackTagValue,
      rootStackId:  this.config.rootStackId,
      regions:      scanTargets.map((target) => target.region),
      granularity:  this.config.granularity,
    });
    return scanTargets;
  }

  private concludeCycle(): void {
    const counts = { attempted: this.updatesAttempted, failed: this.updatesFailed };

    // A cycle in which every update that was tried failed has achieved nothing, so its caller must see a failure.
    if (counts.attempted > 0 && counts.failed === counts.attempted) {
      throw new Error(`all ${counts.attempted} resource updates failed`);
    }

    this.logger.info('artifact update cycle completed', counts);
  }

  private async scanRegion(scan: RegionClients): Promise<void> {
    const resources = await this.rootStackResources.find(scan.tagging, ['lambda:function', 'cloudfront:distribution']);
    for (const mapping of resources) {
      await this.updateResource(scan, mapping);
    }
  }

  private async updateResource(scan: RegionClients, mapping: ResourceTagMapping): Promise<void> {
    const resource = this.readUpdatableResource(mapping);
    if (!resource) {
      return;
    }

    try {
      if (await this.advance(scan, resource)) {
        this.updatesAttempted += 1;
      }
    } catch (thrown) {
      this.updatesAttempted += 1;
      this.updatesFailed    += 1;
      this.recordFailedResource(resource.arn, thrown);
    }
  }

  /** The resource when it opted in to updates and is fully tagged; otherwise undefined, with the reason logged. */
  private readUpdatableResource(mapping: ResourceTagMapping): UpdatableResource | undefined {
    const arn = mapping.ResourceARN;
    if (!arn) {
      return undefined;
    }

    const tags            = this.tagMapFrom(mapping.Tags);
    const service         = this.serviceOf(arn);
    const autoUpdateType  = tags[ServerlessInboxTagKeys.autoUpdateType] ?? 'none';
    const packageName     = tags[ServerlessInboxTagKeys.artifactPackage];
    const artifactName    = tags[ServerlessInboxTagKeys.artifactName];
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
        pkg:          packageName,
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

  /** True when the resource was handed to an updater; false when it is of a kind or in a place no updater takes. */
  private async advance(scan: RegionClients, resource: UpdatableResource): Promise<boolean> {
    if (resource.service === 'cloudfront') {
      return this.advanceDistribution(resource);
    }
    if (resource.service === 'lambda') {
      return this.advanceFunction(scan, resource);
    }
    this.logger.debug('unknown resource type', { arn: resource.arn, resourceType: resource.service });
    return false;
  }

  /** Only a distribution in front of a UI bucket is updated. */
  private async advanceDistribution(resource: UpdatableResource): Promise<boolean> {
    if (resource.autoUpdateType !== 'ui') {
      this.logger.debug('unsupported auto-update-type for CloudFront distribution', {
        arn:  resource.arn,
        type: resource.autoUpdateType,
      });
      return false;
    }

    if (!resource.bucketName) {
      this.logger.debug('UI distribution missing bucket-name tag', { arn: resource.arn });
      return false;
    }

    await this.uiUpdater.advanceIfStale(this.uiTarget(resource, resource.bucketName));
    return true;
  }

  private async advanceFunction(scan: RegionClients, resource: UpdatableResource): Promise<boolean> {
    switch (resource.autoUpdateType) {
      case 'code':
        await this.codeUpdater.advanceIfStale(scan, this.lambdaTarget(resource));
        return true;
      case 'edge':
        return this.advanceEdgeFunction(scan, resource);
      default:
        this.logger.debug('unknown auto-update-type for lambda', { arn: resource.arn, type: resource.autoUpdateType });
        return false;
    }
  }

  /** Lambda@Edge functions live in the edge region only. */
  private async advanceEdgeFunction(scan: RegionClients, resource: UpdatableResource): Promise<boolean> {
    if (scan.region !== EDGE_REGION) {
      this.logger.debug('skipping edge update in non-us-east-1 region', { arn: resource.arn, region: scan.region });
      return false;
    }
    await this.edgeUpdater.advanceIfStale(this.lambdaTarget(resource));
    return true;
  }

  private lambdaTarget(resource: UpdatableResource): LambdaTarget {
    return {
      arn:             toLambdaFunctionArn(resource.arn),
      packageName:     toArtifactPackageName(resource.packageName),
      artifactName:    toArtifactName(resource.artifactName),
      deployedVersion: toArtifactVersion(resource.deployedVersion),
    };
  }

  private uiTarget(resource: UpdatableResource, bucketName: string): UiTarget {
    return {
      arn:             toDistributionArn(resource.arn),
      bucketName:      toContentBucketName(bucketName),
      packageName:     toArtifactPackageName(resource.packageName),
      artifactName:    toArtifactName(resource.artifactName),
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
