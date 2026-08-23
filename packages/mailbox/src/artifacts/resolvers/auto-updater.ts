import { Construct, IConstruct } from 'constructs';
import { Aws, Duration, Fn, IAspect, Tags } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver, ResolvedArtifact } from '../i-artifact-resolver';
import type { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider } from '../../api/addons';
import { ArtifactUpdaterLambda } from '../../lambdas/artifact-updater';
import { ArtifactUpdaterAddon } from '../../addons/artifact-updater-addon';
import { ServerlessInboxTagKeys } from '../../utils/serverless-inbox-tags';

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

export class AutoUpdater extends Construct implements IArtifactResolver, IAdminApiAddonProvider {
  private readonly updater: ArtifactUpdaterLambda;

  private readonly distTag: string;
  private readonly bucketBase: string;
  private readonly project: string = 'serverlessinbox';
  private readonly pinned: PinnedResolver;
  private readonly isTracking: cdk.CfnCondition;
  private readonly registeredPackages = new Set<string>();
  private readonly deployEndTrigger: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: AutoUpdaterProps = {}) {
    super(scope, id);
    this.distTag = props.distTag ?? 'stable';
    const pinnedResolver = PinnedResolver.loadFromArtifactMetadata(this);
    this.pinned = pinnedResolver;
    this.bucketBase = pinnedResolver.getBucketBase();

    const granularity = props.granularity ?? 'minor';

    // Phase B (scheduled updater) support: Fn.conditionIf on code keys + gating self-update infra
    // IsTracking = NOT(granularity == 'pinned') — under pinned, no CRs, no EventBridge rule (updater Lambda always-on)
    this.isTracking = new cdk.CfnCondition(this, 'IsTracking', {
      expression: Fn.conditionNot(Fn.conditionEquals(granularity, 'pinned')),
    });

    // Self-register the package name before constructing the updater Lambda, which will resolve it.
    // This happens before Mailbox (which also registers 'mailbox-cdk' later), ensuring the package
    // is registered when the updater Lambda's code is first resolved.
    this.pinned.registerPackages(['mailbox-cdk']);

    // Artifact updater Lambda (always-on, exists even under pinned for the admin-UI trigger path)
    // Use pinned resolver (same composed instance) to resolve the handler code from stable release
    const updaterEngine = new CdkArtifactEngine(this, this.pinned, 'updater-engine');
    const updater = new ArtifactUpdaterLambda(this, 'artifact-updater', {
      artifactResolver: updaterEngine,
      distTag: this.distTag,
      granularity,
      rootStackTagValue: Aws.STACK_NAME,
    });
    this.updater = updater;

    // Tag the updater Lambda to exclude it from auto-update scanning (via serverless-inbox:auto-update-type=none).
    // This removes the self-reference in environment variables and avoids a circular dependency with LogGroup.
    Tags.of(updater).add(ServerlessInboxTagKeys.autoUpdateType, 'none');

    // Lock/status table for concurrency guard and status tracking (always-on)
    const lockTable = new dynamodb.Table(this, 'update-lock-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // pure operational metadata, no user data
      timeToLiveAttribute: 'ttl',
    });

    // Updater IAM: comprehensive least-privilege (all always-on, apply to updater Lambda for all three trigger paths)
    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['tag:GetResources'],
        resources: ['*'],
      }),
    );

    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:GetFunction', 'lambda:UpdateFunctionCode'],
        resources: [`arn:aws:lambda:*:${Aws.ACCOUNT_ID}:function:*`],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: Aws.STACK_NAME,
          },
        },
      }),
    );

    // TagResource constrained to artifact-version tag only; prevents rewriting root-stack scope or injecting arbitrary tags
    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:TagResource'],
        resources: [`arn:aws:lambda:*:${Aws.ACCOUNT_ID}:function:*`],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: Aws.STACK_NAME,
          },
          'ForAllValues:StringEquals': {
            'aws:TagKeys': [ServerlessInboxTagKeys.artifactVersion],
          },
        },
      }),
    );

    // UI auto-update: extract bundle, upload to bucket, invalidate CloudFront
    // S3 object writes cannot be tag-scoped: aws:ResourceTag reads the (untagged) object, and s3:BucketTag
    // is not honored for PutObject (live-verified deny against a correctly-tagged bucket). Scope by the
    // deterministic UI bucket name instead — ${ACCOUNT_ID}-${STACK_NAME}-ui-<label> (from StackNamedBucket):
    // this stack's dedicated per-UI buckets, this account only.
    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
        resources: [
          `arn:aws:s3:::${Aws.ACCOUNT_ID}-${Aws.STACK_NAME}-ui-*`,
          `arn:aws:s3:::${Aws.ACCOUNT_ID}-${Aws.STACK_NAME}-ui-*/*`,
        ],
      }),
    );

    // Edge auto-update: publish new versions + update CloudFront
    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:GetFunctionConfiguration', 'lambda:PublishVersion'],
        resources: [`arn:aws:lambda:us-east-1:${Aws.ACCOUNT_ID}:function:*`],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: Aws.STACK_NAME,
          },
        },
      }),
    );

    // CloudFront distribution management: scope to this account and root-stack tag.
    // CloudFront distribution resource type supports aws:ResourceTag, so distributions are scoped by the root-stack tag.
    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:GetDistributionConfig', 'cloudfront:UpdateDistribution', 'cloudfront:CreateInvalidation'],
        resources: [`arn:aws:cloudfront::${Aws.ACCOUNT_ID}:distribution/*`],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: Aws.STACK_NAME,
          },
        },
      }),
    );

    // TagResource constrained to distributions matching root-stack tag and allowing only artifact-version mutations.
    // Prevents rewriting root-stack scope or injecting arbitrary tags.
    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:TagResource'],
        resources: [`arn:aws:cloudfront::${Aws.ACCOUNT_ID}:distribution/*`],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: Aws.STACK_NAME,
          },
          'ForAllValues:StringEquals': {
            'aws:TagKeys': [ServerlessInboxTagKeys.artifactVersion],
          },
        },
      }),
    );

    // CloudFront distribution listing: read-only enumeration, unscopable by AWS
    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:ListDistributions'],
        resources: ['*'],
      }),
    );

    updater.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${this.bucketBase}-*/${this.project}/packages/*/releases/*`],
      }),
    );

    // Self-invoke permission
    updater.addPermission('self-invoke', {
      principal: updater.grantPrincipal,
      action: 'lambda:InvokeFunction',
    });

    // Lock table grants for acquire/release operations
    lockTable.grantReadWriteData(updater);

    // Add REGISTERED_PACKAGES env var using Lazy.string to capture the current Set at synth time
    updater.addEnvironment(
      'REGISTERED_PACKAGES',
      cdk.Lazy.string({ produce: () => JSON.stringify([...this.registeredPackages]) }),
    );

    // Add LOCK_TABLE_NAME for status reads in the HTTP trigger handler
    updater.addEnvironment('LOCK_TABLE_NAME', lockTable.tableName);

    // Gated subtree: deploy-end CR + EventBridge rule (both tied to IsTracking)
    const trackedTriggers = new TrackedUpdateTriggers(this, 'tracked-update-triggers', {
      updater,
      isTracking: this.isTracking,
      updateInterval: props.updateInterval ?? Duration.hours(6),
    });

    this.deployEndTrigger = trackedTriggers.deployEndCr;

    // Gate only the TrackedUpdateTriggers subtree (CR + EventBridge rule) on IsTracking
    cdk.Aspects.of(trackedTriggers).add(new GateOnConditionAspect(this.isTracking));
  }

  /** Delegate to the pinned resolver for artifact resolution. */
  resolve(packageName: string, objectPath: string, region: string): ResolvedArtifact {
    return this.pinned.resolve(packageName, objectPath, region);
  }

  /** Register packages for the updater to track (skips unregistered packages in tag-scan loop). */
  registerPackages(names: string[]): void {
    // Delegate to pinned resolver to ensure consistent validation on resolve()
    this.pinned.registerPackages(names);
    // Also track locally for the REGISTERED_PACKAGES env var (Lazy.string will capture this Set)
    for (const n of names) {
      this.registeredPackages.add(n);
    }
  }

  /** Provide the artifact updater addon for admin API registration. */
  createAdminApiAddons(_scope: Construct, _ctx: AdminApiAddonContext): IAdminApiAddon[] {
    return [new ArtifactUpdaterAddon({ updaterFunction: this.updater })];
  }

  /**
   * Register a construct whose whole subtree the deploy-time update trigger must not fire
   * before — e.g. a sub-stack or resource group that needs to finish deploying first. Safe to
   * call multiple times (once per dependency).
   */
  addDeployEndDependency(dependency: IConstruct): void {
    this.deployEndTrigger.node.addDependency(dependency);
  }
}

/**
 * Child construct: holds the deploy-end CR and EventBridge rule, both gated on IsTracking.
 * The Aspect applies only to this subtree, keeping the updater Lambda (always-on) outside the gate.
 */
class TrackedUpdateTriggers extends Construct {
  readonly deployEndCr: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: {
    updater: lambda.IFunction;
    isTracking: cdk.CfnCondition;
    updateInterval: Duration;
  }) {
    super(scope, id);

    // Deploy-end CR: fires when the stack is deployed with ArtifactTracking != pinned
    // ServiceToken points to the updater Lambda; the handler detects CFN CR events and routes accordingly
    const deployEndCr = new cdk.CustomResource(this, 'deploy-end-cr-v2', {
      serviceToken: props.updater.functionArn,
      serviceTimeout: cdk.Duration.seconds(600),
      resourceType: 'Custom::DeployEndTrigger',
      properties: {
        Nonce: Date.now().toString(),
      },
    });
    this.deployEndCr = deployEndCr;

    // EventBridge rule: trigger the updater on schedule (6-hourly self-healing loop)
    new events.Rule(this, 'scheduled-update-rule', {
      schedule: events.Schedule.rate(props.updateInterval),
      targets: [new targets.LambdaFunction(props.updater)],
    });
  }
}
