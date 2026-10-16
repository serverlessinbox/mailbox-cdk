import { PublishVersionCommand } from '@aws-sdk/client-lambda';
import {
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  type CloudFrontClient,
  type DistributionConfig,
  type LambdaFunctionAssociation,
} from '@aws-sdk/client-cloudfront';
import { GetResourcesCommand } from '@aws-sdk/client-resource-groups-tagging-api';
import {
  CaughtError,
  parseArn,
  ServerlessInboxTagKeys,
  type LoggerBuffer,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { LambdaTarget } from './artifact-target';
import type { FunctionSmokeTester, SmokeTestVerdict } from './function-smoke-tester';
import type { LambdaCodeRollback } from './lambda-code-rollback';
import type { LambdaFunctionCode, Sleep } from './lambda-function-code';
import type { ArtifactLocation, ReleaseArtifacts, StaleTarget } from './release-artifacts';
import type { RegionClients } from './updater-clients';
import { toLambdaFunctionArn, type LambdaFunctionArn } from './updater-identifiers';

const CONFLICT_RETRY_DELAYS_MS = [3000, 6000];

/** The cache behaviours of a distribution, in which Lambda@Edge functions are associated. */
type CacheBehaviorsOf = Pick<DistributionConfig, 'DefaultCacheBehavior' | 'CacheBehaviors'>;

/** The CloudFront distribution that uses a function, with the configuration and ETag an update must send back. */
interface DistributionOfFunction {
  readonly id: string;
  readonly config: DistributionConfig;
  readonly etag: string;
}

/**
 * Advances a Lambda@Edge function to the newer release of its code: replaces the code, publishes a version and
 * probes that version with the smoke test. Only when the probe passes are the function's associations in its
 * CloudFront distribution pointed at the version and the artifact version tag written. When the probe fails, or
 * cannot be run, the distribution is not touched and the function's code is put back on the deployed release.
 */
export class EdgeLambdaUpdater {
  private readonly edge: RegionClients;
  private readonly cloudFront: CloudFrontClient;
  private readonly rootStackTagValue: string;
  private readonly releases: ReleaseArtifacts;
  private readonly functionCode: LambdaFunctionCode;
  private readonly smokeTester: FunctionSmokeTester;
  private readonly rollback: LambdaCodeRollback;
  private readonly logger: LoggerBuffer;
  private readonly sleep: Sleep;

  constructor(
    edge: RegionClients,
    cloudFront: CloudFrontClient,
    rootStackTagValue: string,
    releases: ReleaseArtifacts,
    functionCode: LambdaFunctionCode,
    smokeTester: FunctionSmokeTester,
    rollback: LambdaCodeRollback,
    logger: LoggerBuffer,
    sleep: Sleep,
  ) {
    this.edge = edge;
    this.cloudFront = cloudFront;
    this.rootStackTagValue = rootStackTagValue;
    this.releases = releases;
    this.functionCode = functionCode;
    this.smokeTester = smokeTester;
    this.rollback = rollback;
    this.logger = logger;
    this.sleep = sleep;
  }

  /**
   * True when the function and its distribution were advanced; false when the function was not behind or its
   * new version did not pass the smoke test.
   */
  public async advanceIfStale(target: LambdaTarget): Promise<boolean> {
    const stale = await this.releases.findNewer(this.edge.region, target.packageName, target.deployedVersion);
    if (!stale) {
      return false;
    }

    const location = this.releases.locate(this.edge.region, target.packageName, stale.parsed, this.objectName(target));

    try {
      await this.deployNewCode(target, stale, location);
      const newVersionArn = await this.publishVersion(target);
      const verdict = await this.smokeTester.probe(this.edge.lambda, newVersionArn);
      if (verdict !== 'pass') {
        await this.keepDistributionOnDeployedVersion(target, stale, verdict);
        return false;
      }

      const distribution = await this.findDistributionOf(target);
      await this.repoint(target, distribution, newVersionArn);
      await this.functionCode.tagArtifactVersion(this.edge.lambda, target.arn, stale.version);

      this.logger.info('edge lambda updated', {
        edgeLambdaArn: target.arn,
        newVersionArn,
        distributionId: distribution.id,
        oldVersion: target.deployedVersion,
        newVersion: stale.version,
      });
      return true;
    } catch (thrown) {
      this.recordFailedUpdate(target, thrown);
      throw thrown;
    }
  }

  private async deployNewCode(target: LambdaTarget, stale: StaleTarget, location: ArtifactLocation): Promise<void> {
    this.logger.info('updating edge lambda code', {
      edgeLambdaArn: target.arn,
      artifactBucket: location.bucket,
      artifactKey: location.key,
      newVersion: stale.version,
    });

    await this.updateCodeRetryingConflicts(target, location);
    await this.functionCode.waitUntilSettled(this.edge.lambda, target.arn);
  }

  /** Lambda rejects a code update while another update of the function is in progress; that is retried after a delay. */
  private async updateCodeRetryingConflicts(target: LambdaTarget, location: ArtifactLocation): Promise<void> {
    for (const [index, delayMs] of CONFLICT_RETRY_DELAYS_MS.entries()) {
      try {
        await this.functionCode.update(this.edge.lambda, target.arn, location);
        return;
      } catch (thrown) {
        await this.waitBeforeRetry(target, thrown, index + 1, delayMs);
      }
    }

    await this.functionCode.update(this.edge.lambda, target.arn, location);
  }

  private async waitBeforeRetry(target: LambdaTarget, thrown: unknown, attempt: number, delayMs: number): Promise<void> {
    const caught = new CaughtError(thrown);
    if (!caught.is('ResourceConflictException')) {
      throw thrown;
    }

    this.logger.info('UpdateFunctionCode conflict, retrying', {
      edgeLambdaArn: target.arn,
      attempt,
      nextRetryDelayMs: delayMs,
      error: caught.message,
    });
    await this.sleep(delayMs);
  }

  private async publishVersion(target: LambdaTarget): Promise<LambdaFunctionArn> {
    const published = await this.edge.lambda.send(new PublishVersionCommand({ FunctionName: target.arn }));
    if (!published.FunctionArn) {
      throw new Error('PublishVersion returned no FunctionArn');
    }
    return toLambdaFunctionArn(published.FunctionArn);
  }

  /**
   * The distribution stays on the version it serves, and the function's code goes back to the deployed release
   * so that the next update starts from it. The published version that failed stays unreferenced.
   */
  private async keepDistributionOnDeployedVersion(
    target: LambdaTarget,
    stale: StaleTarget,
    verdict: SmokeTestVerdict,
  ): Promise<void> {
    const deployedLocation = this.releases.locate(
      this.edge.region,
      target.packageName,
      stale.deployed,
      this.objectName(target),
    );
    await this.rollback.restore(this.edge.lambda, target, stale, verdict, deployedLocation);
  }

  private objectName(target: LambdaTarget): string {
    return `lambdas/${target.artifactName}.zip`;
  }

  /** The first distribution of this install that associates the function, whatever the version or event type of the association. */
  private async findDistributionOf(target: LambdaTarget): Promise<DistributionOfFunction> {
    for (const distributionId of await this.findTaggedDistributionIds()) {
      const distribution = await this.readDistribution(distributionId);
      if (distribution && this.lambdaAssociationsOf(distribution.config).some((association) => this.isAssociationOf(target, association))) {
        return distribution;
      }
    }

    throw this.noDistributionFound(target);
  }

  /** The ids of the distributions that carry the root stack tag of this install, looked up in the edge region. */
  private async findTaggedDistributionIds(): Promise<string[]> {
    const distributionIds: string[] = [];
    let paginationToken: string | undefined;

    do {
      const page = await this.edge.tagging.send(
        new GetResourcesCommand({
          TagFilters: [{ Key: ServerlessInboxTagKeys.rootStack, Values: [this.rootStackTagValue] }],
          ResourceTypeFilters: ['cloudfront:distribution'],
          PaginationToken: paginationToken,
        }),
      );
      for (const mapping of page.ResourceTagMappingList ?? []) {
        if (mapping.ResourceARN) {
          distributionIds.push(parseArn(mapping.ResourceARN).resourceId);
        }
      }
      paginationToken = page.PaginationToken;
    } while (paginationToken);

    return distributionIds;
  }

  /** The distribution with its ETag, or undefined when CloudFront returns it without its configuration or ETag. */
  private async readDistribution(distributionId: string): Promise<DistributionOfFunction | undefined> {
    const fetched = await this.cloudFront.send(new GetDistributionConfigCommand({ Id: distributionId }));
    if (!fetched.DistributionConfig || !fetched.ETag) {
      return undefined;
    }
    return { id: distributionId, config: fetched.DistributionConfig, etag: fetched.ETag };
  }

  private noDistributionFound(target: LambdaTarget): Error {
    return new Error(`No CloudFront distribution found for edge lambda ${target.arn}`);
  }

  private async repoint(
    target: LambdaTarget,
    distribution: DistributionOfFunction,
    newVersionArn: LambdaFunctionArn,
  ): Promise<void> {
    for (const association of this.lambdaAssociationsOf(distribution.config)) {
      if (this.isAssociationOf(target, association)) {
        association.LambdaFunctionARN = newVersionArn;
      }
    }

    await this.cloudFront.send(
      new UpdateDistributionCommand({
        Id: distribution.id,
        DistributionConfig: distribution.config,
        IfMatch: distribution.etag,
      }),
    );
  }

  private lambdaAssociationsOf(behaviors: CacheBehaviorsOf): LambdaFunctionAssociation[] {
    const defaultAssociations = behaviors.DefaultCacheBehavior?.LambdaFunctionAssociations?.Items ?? [];
    const additionalAssociations = (behaviors.CacheBehaviors?.Items ?? []).flatMap(
      (behavior) => behavior.LambdaFunctionAssociations?.Items ?? [],
    );
    return [...defaultAssociations, ...additionalAssociations];
  }

  private isAssociationOf(target: LambdaTarget, association: LambdaFunctionAssociation): boolean {
    return this.withoutVersion(association.LambdaFunctionARN ?? '') === this.withoutVersion(target.arn);
  }

  private withoutVersion(arn: string): string {
    return arn.replace(/:\d+$/, '');
  }

  private recordFailedUpdate(target: LambdaTarget, thrown: unknown): void {
    this.logger.error('failed to update edge lambda', {
      edgeLambdaArn: target.arn,
      error: new CaughtError(thrown).message,
    });
  }
}
