import { Construct, IConstruct } from 'constructs';
import { Aws, Duration, Fn, IAspect } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { buildArtifactBucketName, buildArtifactKey } from '@serverlessinbox/artifact-registry';
import {
  TRACK_RESOLVER_HANDLER_SOURCE,
  TRACK_RESOLVER_VERSION_ATTR,
  buildTrackResolverProperties,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver, ResolvedArtifact } from '../i-artifact-resolver';
import { ScheduledUpdaterLambda } from '../../lambdas/scheduled-updater';

/**
 * Aspect that gates all CfnResource children of a construct onto an IsTracking condition.
 * Used to ensure the entire self-update subtree (CRs, Lambda, rule, roles, policies, etc.)
 * produces zero resources under pinned mode.
 */
class GateOnConditionAspect implements IAspect {
  constructor(private condition: cdk.CfnCondition) {}

  visit(node: IConstruct): void {
    // Skip the condition itself (a condition cannot carry a condition)
    if (node === this.condition) return;

    // Gate every CfnResource in the subtree
    if (cdk.CfnResource.isCfnResource(node)) {
      node.cfnOptions.condition = this.condition;
    }
  }
}

/** Update-drift granularity for the Phase B scheduled updater (like npm ^/~). Unused at deploy. */
export type Granularity = 'major' | 'minor';

/**
 * Auto-updater (stack-self-update #3). npm-style: at DEPLOY the per-package CR reads the
 * `{distTag}` pointer (`releases/{distTag}.json`) and locks that version — distTag only, no
 * synth-time version, no ambient-context dependency, works in any stack. `granularity` is retained
 * as config for the Phase B scheduled updater (drift range from the locked version) and is NOT used
 * at deploy-time resolution.
 */
export interface AutoUpdaterProps {
  /** Dist-tag line to follow (default 'stable'); resolved to a concrete version at deploy. */
  readonly distTag?: string;
  /** Literal Granularity OR a CFN-parameter token; used for the updater's env and IsTracking. Typed `string`. */
  readonly granularity?: string;
  /** Update interval for the scheduled updater (default 6 hours). */
  readonly updateInterval?: Duration;
}

export class AutoUpdater extends Construct implements IArtifactResolver {
  private readonly lambdaFn: lambda.Function;
  private readonly customResources = new Map<string, cdk.CfnCustomResource>();
  private readonly distTag: string;
  private readonly bucketBase: string;
  private readonly project: string = 'serverlessinbox';
  private readonly pinned: PinnedResolver;
  private readonly isTracking: cdk.CfnCondition;

  constructor(scope: Construct, id: string, props: AutoUpdaterProps = {}) {
    super(scope, id);
    this.distTag = props.distTag ?? 'stable';
    const pinnedResolver = PinnedResolver.loadFromArtifactMetadata(this);
    this.pinned = pinnedResolver;
    this.bucketBase = pinnedResolver.getBucketBase();

    const granularity = props.granularity ?? 'minor';

    // Phase B (scheduled updater) support: Fn.conditionIf on code keys + all self-update infra
    // IsTracking = NOT(granularity == 'pinned') — under pinned, no CRs, no updater, no rule, no DLQ
    this.isTracking = new cdk.CfnCondition(this, 'IsTracking', {
      expression: Fn.conditionNot(Fn.conditionEquals(granularity, 'pinned')),
    });

    // Create the shared resolver Lambda (gated on IsTracking)
    const fn = new lambda.Function(this, 'provider-handler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromInline(TRACK_RESOLVER_HANDLER_SOURCE),
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: `Serverless Inbox Mailbox: track-resolver provider (${Aws.STACK_NAME})`,
      environment: {
        ARTIFACT_BUCKET_BASE: this.bucketBase,
        PROJECT: this.project,
      },
    });

    // IAM: read-only, project-scoped wildcard covers all packages this resolver serves.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [
          `arn:aws:s3:::${this.bucketBase}-${Aws.REGION}/${this.project}/packages/*/releases/*`,
          `arn:aws:s3:::${this.bucketBase}-us-east-1/${this.project}/packages/*/releases/*`,
        ],
      }),
    );

    this.lambdaFn = fn;

    // Phase B: Scheduled updater Lambda, EventBridge rule, DLQ (all gated on IsTracking)
    // Use pinned resolver (same composed instance) to resolve the handler code from stable release
    const updaterEngine = new CdkArtifactEngine(this, this.pinned, 'updater-engine');
    const updater = new ScheduledUpdaterLambda(this, 'scheduled-updater', {
      artifactResolver: updaterEngine,
      distTag: this.distTag,
      granularity,
      rootStackTagValue: Aws.STACK_NAME,
    });
    updater.addEnvironment('UPDATER_FUNCTION_ARN', updater.functionArn);

    // Updater IAM: comprehensive least-privilege
    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['resourcegroupstaggingapi:GetResources'],
        resources: ['*'],
      }),
    );

    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:GetFunction', 'lambda:UpdateFunctionCode', 'lambda:TagResource'],
        resources: [`arn:aws:lambda:*:${Aws.ACCOUNT_ID}:function:*`],
        conditions: {
          StringEquals: {
            'aws:ResourceTag/serverless-inbox:root-stack': Aws.STACK_NAME,
          },
        },
      }),
    );

    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${this.bucketBase}-*/${this.project}/packages/*/releases/*`],
      }),
    );

    // EventBridge rule: trigger the updater on schedule (6-hourly self-healing loop)
    new events.Rule(this, 'scheduled-update-rule', {
      schedule: events.Schedule.rate(props.updateInterval ?? Duration.hours(6)),
      targets: [new targets.LambdaFunction(updater)],
    });

    // Gate the entire AutoUpdater subtree (all CfnResources) on IsTracking using an Aspect.
    // This ensures that under pinned mode, zero self-update infrastructure is generated:
    // - provider-handler Lambda + role + policies
    // - per-package CRs
    // - updater Lambda + role + policies + permissions
    // - EventBridge rule + target permissions
    cdk.Aspects.of(this).add(new GateOnConditionAspect(this.isTracking));
  }

  /** Deploy-time: per-package CR reads `releases/{distTag}.json` → locked version token; key built from it.
   *  In standard-app (token-granularity) mode with Fn.conditionIf: key is conditional (tracked vs pinned). */
  resolve(packageName: string, objectPath: string, region: string): ResolvedArtifact {
    const key = this.getResolvedKeyToken(packageName, this.distTag, region, objectPath);
    const bucket = buildArtifactBucketName(this.bucketBase, region);
    return { bucket, key, versionId: undefined };
  }

  /**
   * Gets or creates a per-package CfnCustomResource pointing at the shared Lambda, then returns
   * the deploy-time-resolved artifact key as a token string via Fn.getAtt.
   * In standard-app mode, returns Fn.conditionIf(IsTracking, <CR-token>, <pinned-literal>).
   */
  private getResolvedKeyToken(
    packageName: string,
    distTag: string,
    region: string,
    objectName: string,
  ): string {
    // Ensure the per-package CR exists (created once, then reused)
    if (!this.customResources.has(packageName)) {
      const resource = new cdk.CfnCustomResource(this, `resource-${packageName}`, {
        serviceToken: this.lambdaFn.functionArn,
        // Fire-and-return category: 2x the backing Lambda's own 30s timeout.
        serviceTimeout: 60,
      });

      const properties = buildTrackResolverProperties({
        package: packageName,
        distTag,
        region,
      });
      for (const [key, value] of Object.entries(properties)) {
        resource.addPropertyOverride(key, value);
      }

      this.customResources.set(packageName, resource);
    }

    const resource = this.customResources.get(packageName)!;
    const versionToken = cdk.Fn.getAtt(resource.logicalId, TRACK_RESOLVER_VERSION_ATTR).toString();

    // Tracked key (from CR-resolved version token)
    const trackedKey = buildArtifactKey('package', packageName, {
      type: 'release',
      version: { version: versionToken } as any,
      objectName,
      project: this.project,
    });

    // Pinned key (from this.pinned resolver — synth-time literal)
    const pinnedKey = this.pinned.resolve(packageName, objectName, region).key;

    // Standard-app mode: Fn.conditionIf(IsTracking, trackedKey, pinnedKey)
    // Bucket is identical; only the key is conditional
    const conditionalKey = Fn.conditionIf(this.isTracking.logicalId, trackedKey, pinnedKey).toString();

    return conditionalKey;
  }
}
