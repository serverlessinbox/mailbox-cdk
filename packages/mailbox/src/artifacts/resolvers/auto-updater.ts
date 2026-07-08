import { Construct } from 'constructs';
import { Aws, Duration } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import { buildArtifactBucketName, buildArtifactKey } from '@serverlessinbox/artifact-registry';
import {
  TRACK_RESOLVER_HANDLER_SOURCE,
  TRACK_RESOLVER_VERSION_ATTR,
  buildTrackResolverProperties,
} from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver, ResolvedArtifact } from '../i-artifact-resolver';

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
  /** Drift range for the Phase B scheduled updater (default 'minor'). Not used at deploy. */
  readonly granularity?: Granularity;
}

export class AutoUpdater extends Construct implements IArtifactResolver {
  private readonly lambdaFn: lambda.Function;
  private readonly customResources = new Map<string, cdk.CfnCustomResource>();
  private readonly distTag: string;
  private readonly bucketBase: string;
  private readonly project: string = 'serverlessinbox';

  constructor(scope: Construct, id: string, props: AutoUpdaterProps = {}) {
    super(scope, id);
    this.distTag = props.distTag ?? 'stable';
    this.bucketBase = PinnedResolver.loadFromArtifactMetadata(this).getBucketBase();

    // Create the shared resolver Lambda
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
  }

  /** Deploy-time: per-package CR reads `releases/{distTag}.json` → locked version token; key built from it. */
  resolve(packageName: string, objectPath: string, region: string): ResolvedArtifact {
    const key = this.getResolvedKeyToken(packageName, this.distTag, region, objectPath);
    const bucket = buildArtifactBucketName(this.bucketBase, region);
    return { bucket, key, versionId: undefined };
  }

  /**
   * Gets or creates a per-package CfnCustomResource pointing at the shared Lambda, then returns
   * the deploy-time-resolved artifact key as a token string via Fn.getAtt.
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

    // Build the artifact key using the resolved version token and the object name.
    return buildArtifactKey('package', packageName, {
      type: 'release',
      version: { version: versionToken } as any,
      objectName,
      project: this.project,
    });
  }
}
