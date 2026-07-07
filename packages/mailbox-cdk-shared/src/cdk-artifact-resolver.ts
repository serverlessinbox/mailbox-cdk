import { Code } from 'aws-cdk-lib/aws-lambda';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Stack } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';
import { ArtifactResolver } from '@serverlessinbox/artifact-registry';
import type { ArtifactResolverFactoryOptions, IArtifactResolver, ResolvedArtifact, ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import { SHARED_GROUP_ID, SINGLETON_ID, TrackResolverProvider } from './track-resolver-provider';

export type TrackGranularity = 'major' | 'minor';

export interface CdkArtifactResolverOptions {
  /** Optional track configuration. If provided, the resolver will create/discover a provider. */
  readonly track?: {
    readonly granularity: TrackGranularity;
    readonly distTag: string;
  };
}

export interface ICdkArtifactResolver extends IArtifactResolver {
  getCode(packageName: string, objectPath: string): Code;
}

export class CdkArtifactResolver extends ArtifactResolver implements ICdkArtifactResolver {
  private readonly _scope: IConstruct;
  private readonly _bucketCache = new Map<string, IBucket>();
  private readonly _trackConfig?: { granularity: TrackGranularity; distTag: string };
  private readonly _deploymentRegion: string;
  private readonly _packages: Record<string, ArtifactVersionsEntry>;

  constructor(
    options: ArtifactResolverFactoryOptions,
    scope: IConstruct,
    cdkOptions?: CdkArtifactResolverOptions,
  ) {
    super(options);
    this._scope = scope;
    this._trackConfig = cdkOptions?.track;
    this._deploymentRegion = options.deploymentRegion;
    this._packages = options.versions.packages;

    // If track config provided, ensure the provider exists for this stack
    if (this._trackConfig) {
      const stack = Stack.of(scope);
      const artifactBucketBase = this.getBucketBase();
      TrackResolverProvider.getOrCreate(stack, {
        artifactBucketBase,
        project: 'serverlessinbox',
        granularity: this._trackConfig.granularity,
        distTag: this._trackConfig.distTag,
      });
    }
  }

  private bucketFor(packageName: string, objectPath: string): IBucket {
    if (!this._bucketCache.has(packageName)) {
      // Use the base resolver to get the bucket (synth-time constant, regardless of track mode)
      const basePinned = super.resolve(packageName, objectPath);
      this._bucketCache.set(
        packageName,
        Bucket.fromBucketName(this._scope, `Bucket-${packageName}`, basePinned.bucket),
      );
    }
    return this._bucketCache.get(packageName)!;
  }

  /**
   * Override: pinned mode delegates to base; track mode discovers the singleton provider from the
   * stack, reads its config, and returns token-based artifact data.
   *
   * This is the single resolution seam: all artifact types (Lambda code, UI zips, and later CF
   * templates) flow through here, so track resolution applies uniformly. Track mode is discovered
   * via the stack-scoped singleton provider: if present, we're in track mode; if absent, pinned.
   */
  override resolve(packageName: string, objectPath: string): ResolvedArtifact {
    const stack = Stack.of(this._scope);
    const sharedGroup = stack.node.tryFindChild(SHARED_GROUP_ID);
    const provider = sharedGroup?.node.tryFindChild(SINGLETON_ID) as TrackResolverProvider | undefined;

    // Pinned mode: use base resolver (synth-time-pinned version from artifact-versions.json)
    if (!provider) {
      return super.resolve(packageName, objectPath);
    }

    // Track mode: get anchor version, resolve via provider
    const version = super.getVersion(packageName);
    const anchor = super.resolve(packageName, objectPath);
    const config = provider.getConfig();

    // Determine the per-package region from its zone: edge → us-east-1, regional → deploymentRegion
    const EDGE_REGION = 'us-east-1';
    const pkgEntry = this._packages[packageName];
    const region = pkgEntry?.zone === 'edge' ? EDGE_REGION : this._deploymentRegion;

    // Ensure the per-package CR exists and get the deploy-time-resolved key token
    const keyToken = provider.getResolvedKeyToken(
      packageName,
      version,
      config.granularity,
      config.distTag,
      region,
      objectPath,
    );

    // Return a ResolvedArtifact with the token-based key (will be used by Code.fromBucket)
    return {
      bucket: anchor.bucket,
      key: keyToken,
      versionId: undefined, // Token keys don't use versionId
    };
  }

  getCode(packageName: string, objectPath: string): Code {
    const resolved = this.resolve(packageName, objectPath);
    return Code.fromBucket(this.bucketFor(packageName, objectPath), resolved.key, resolved.versionId);
  }
}
