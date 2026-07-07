import * as cdk from 'aws-cdk-lib';
import { Aws, Duration, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import {
  TRACK_RESOLVER_HANDLER_SOURCE,
  TRACK_RESOLVER_VERSION_ATTR,
  buildTrackResolverProperties,
  buildArtifactKey,
} from '@serverlessinbox/artifact-registry';
import type { TrackGranularity } from './cdk-artifact-resolver';

/** Top-level organizational group under the stack that houses shared/singleton constructs. */
export const SHARED_GROUP_ID = 'shared';
/** Id of the TrackResolverProvider singleton within the shared group. */
export const SINGLETON_ID = 'track-resolver-provider';

export interface TrackResolverProviderConfig {
  /** Artifact bucket base (without region suffix) -- e.g. "mailbox-artifacts" -> "mailbox-artifacts-{region}". */
  readonly artifactBucketBase: string;
  /** Project prefix for S3 artifact paths. */
  readonly project: string;
  /** Track granularity: major or minor. */
  readonly granularity: TrackGranularity;
  /** Pointer line within the track (e.g., "stable", "beta"). */
  readonly distTag: string;
}

/**
 * Singleton track-resolver provider per stack (subplan #2, stack-self-update).
 *
 * Manages a single resolver Lambda + N per-package CfnCustomResources (one CR per resolved package).
 * All packages share the same Lambda; each gets its own CR so CFN can track and update them independently.
 * Carries the track configuration (project, granularity, distTag, artifactBucketBase) for the stack.
 *
 * Called dynamically via the CdkArtifactResolver.resolve() override: whenever an artifact is resolved
 * in track mode, ensures that package's CR exists and returns the deploy-time key token.
 *
 * The singleton is created once per stack via `TrackResolverProvider.getOrCreate(...)` and reused.
 */
export class TrackResolverProvider extends Construct {
  private readonly _lambdaFn: lambda.Function;
  private readonly _customResources = new Map<string, cdk.CfnCustomResource>();
  private readonly _config: TrackResolverProviderConfig;

  constructor(scope: Construct, id: string, config: TrackResolverProviderConfig) {
    super(scope, id);

    this._config = config;
    const DEFAULT_PROJECT = config.project;
    // Default bucket base to 'mailbox-artifacts' if undefined; ensures env var and IAM ARN are always consistent.
    const artifactBucketBase = config.artifactBucketBase || 'mailbox-artifacts';

    const fn = new lambda.Function(this, 'handler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromInline(TRACK_RESOLVER_HANDLER_SOURCE),
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: `Serverless Inbox Mailbox: track-resolver provider (${Aws.STACK_NAME})`,
      environment: {
        ARTIFACT_BUCKET_BASE: artifactBucketBase,
        PROJECT: DEFAULT_PROJECT,
      },
    });

    // IAM: read-only, project-scoped wildcard covers all packages this provider serves.
    // Pattern mirrors artifact-registry's S3 key schema (deliberately NOT extracted to avoid over-engineering).
    // Include both deployment region and us-east-1 (for edge-zone packages).
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [
          `arn:aws:s3:::${artifactBucketBase}-${Aws.REGION}/${DEFAULT_PROJECT}/packages/*/releases/*`,
          `arn:aws:s3:::${artifactBucketBase}-us-east-1/${DEFAULT_PROJECT}/packages/*/releases/*`,
        ],
      }),
    );

    this._lambdaFn = fn;
  }

  /**
   * Gets or creates the singleton `TrackResolverProvider` for this stack, nested under a top-level
   * `'shared'` organizational group (`stack/shared/track-resolver-provider`) so shared/singleton
   * concepts sit together in the CloudFormation logical-id tree.
   * Uses `node.tryFindChild` to ensure only one group -- and one provider within it -- per stack.
   */
  static getOrCreate(scope: Construct, config: TrackResolverProviderConfig): TrackResolverProvider {
    const stack = Stack.of(scope);
    const sharedGroup =
      (stack.node.tryFindChild(SHARED_GROUP_ID) as Construct | undefined) ??
      new Construct(stack, SHARED_GROUP_ID);

    const existing = sharedGroup.node.tryFindChild(SINGLETON_ID);
    if (existing) {
      return existing as TrackResolverProvider;
    }

    return new TrackResolverProvider(sharedGroup, SINGLETON_ID, config);
  }

  /**
   * Gets the track config carried by this provider.
   */
  getConfig(): TrackResolverProviderConfig {
    return this._config;
  }

  /**
   * Gets or creates a per-package CfnCustomResource pointing at the singleton Lambda, then returns
   * the deploy-time-resolved artifact key as a token string via Fn.getAtt.
   *
   * The CfnCustomResource is created once per package and cached; subsequent calls for the same
   * package reuse it. This ensures each package gets its own CFN resource for independent tracking.
   * The CR returns the resolved version, and the artifact key is built via buildArtifactKey with
   * that token.
   */
  getResolvedKeyToken(
    packageName: string,
    version: string,
    granularity: TrackGranularity,
    distTag: string,
    region: string,
    objectName: string,
  ): string {
    // Ensure the per-package CR exists (created once, then reused)
    if (!this._customResources.has(packageName)) {
      const resource = new cdk.CfnCustomResource(this, `resource-${packageName}`, {
        serviceToken: this._lambdaFn.functionArn,
        // Fire-and-return category: 2x the backing Lambda's own 30s timeout.
        serviceTimeout: 60,
      });

      const properties = buildTrackResolverProperties({
        package: packageName,
        version,
        granularity,
        distTag,
        region,
      });
      for (const [key, value] of Object.entries(properties)) {
        resource.addPropertyOverride(key, value);
      }

      this._customResources.set(packageName, resource);
    }

    const resource = this._customResources.get(packageName)!;
    const versionToken = cdk.Fn.getAtt(resource.logicalId, TRACK_RESOLVER_VERSION_ATTR).toString();

    // Build the artifact key using the resolved version token and the object name.
    return buildArtifactKey('package', packageName, {
      type: 'release',
      version: { version: versionToken } as any,
      objectName,
      project: this._config.project,
    });
  }
}
