import { Code } from 'aws-cdk-lib/aws-lambda';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Stack } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';
import { Construct } from 'constructs';
import { ArtifactResolver, buildArtifactUrl, buildArtifactArn } from '@serverlessinbox/artifact-registry';
import type { ArtifactVersionsEntry, ArtifactZone } from '@serverlessinbox/artifact-registry';
import { ARTIFACTS_CONTEXT_KEY, ARTIFACT_VERSIONS_CONTEXT_KEY } from './context-keys';

const DEFAULT_BUCKET_BASE = 'mailbox-artifacts';
const EDGE_PACKAGES = new Set<string>(['mailbox-cdk-edge']);

/** Resolved S3 location of an artifact object. */
export interface ResolvedArtifact {
  readonly bucket: string;
  readonly key: string;
  readonly versionId?: string;
}

/**
 * Injectable resolution strategy: given a package + object + region, produce the S3 location.
 * Region is supplied by the caller (the engine defaults it to the deployment region; edge callers
 * pass 'us-east-1'). Implemented by PinnedResolver (default) and AutoUpdater (tracking).
 */
export interface IArtifactResolver {
  resolve(packageName: string, objectPath: string, region: string): ResolvedArtifact;
}

/**
 * Extended resolver interface that optionally supports package registration.
 * Used by wrappers to safely call registerPackages on resolvers that implement it.
 */
interface ResolverWithOptionalPackageRegistration extends IArtifactResolver {
  registerPackages?(names: string[]): void;
}

/**
 * Consumer contract used by mailbox/cognito sub-constructs — they depend on THIS interface,
 * never the concrete CdkArtifactEngine class.
 */
export interface ICdkArtifactEngine {
  getCode(packageName: string, objectPath: string, region?: string): Code;
  getUrl(packageName: string, objectPath: string, region?: string): string;
  getArn(packageName: string, objectPath: string, region?: string): string;
  getVersion(packageName: string): string;
  getBucketBase(): string;
  resolve(packageName: string, objectPath: string, region?: string): ResolvedArtifact;
  registerPackages(names: string[]): void;
}

/** Synth-time version for one package. */
export interface VersionMapEntry {
  readonly version: string;
}
export type VersionMap = Record<string, VersionMapEntry>;

/**
 * Helper to track registered package names and validate resolve() calls.
 * Shared by PinnedResolver, ChannelResolver, and AutoUpdater (via delegation).
 * @internal
 */
class PackageRegistry {
  private readonly registered = new Set<string>();

  registerPackages(names: string[]): void {
    for (const name of names) {
      this.registered.add(name);
    }
  }

  validatePackage(packageName: string): void {
    if (!this.registered.has(packageName)) {
      throw new Error(
        `Artifact package "${packageName}" was not registered. ` +
        `Call registerPackages([...]) before resolving unregistered packages at synth time.`
      );
    }
  }

  isRegistered(packageName: string): boolean {
    return this.registered.has(packageName);
  }
}

/**
 * Default strategy: resolves every artifact from a version map assembled from CDK context,
 * delegating ALL schema (release-vs-channel prefix, versionId, zone→region) to artifact-registry's
 * ArtifactResolver. ONE unified map (all packages; cognito is not special). Not jsii-exported.
 */
export class PinnedResolver implements IArtifactResolver {
  private readonly inner: ArtifactResolver;
  private readonly packageRegistry = new PackageRegistry();

  constructor(
    scope: IConstruct,
    packages: Record<string, ArtifactVersionsEntry>,
    bucketBase: string,
    s3VersionMap: Record<string, string>,
  ) {
    this.inner = new ArtifactResolver({
      versions: { bucketBase, packages },
      deploymentRegion: Stack.of(scope).region,
      s3VersionMap,
    });
  }

  /**
   * Build the version map from CDK context (context.artifacts.packages + context.artifactVersions),
   * populated by the app/infra entrypoint. Handles both release (kind:'release') and channel
   * (kind:'channel') entries; zone comes from the canonical edge-package set. NOTE: does not read a
   * package's baked artifact-versions.json — a published/from-source consumer with no context is a
   * deferred concern; all current entrypoints inject context.
   */
  static loadFromArtifactMetadata(scope: IConstruct): PinnedResolver {
    const ctx = scope.node.tryGetContext(ARTIFACTS_CONTEXT_KEY) as
      | { bucketBase?: unknown; packages?: unknown }
      | undefined;
    const s3VersionMap =
      (scope.node.tryGetContext(ARTIFACT_VERSIONS_CONTEXT_KEY) as Record<string, string> | undefined) ?? {};
    const bucketBase =
      ctx && typeof ctx === 'object' && typeof ctx.bucketBase === 'string'
        ? ctx.bucketBase
        : DEFAULT_BUCKET_BASE;
    const packages: Record<string, ArtifactVersionsEntry> = {};
    if (ctx && typeof ctx === 'object' && ctx.packages && typeof ctx.packages === 'object') {
      for (const [name, target] of Object.entries(
        ctx.packages as Record<string, Record<string, unknown>>,
      )) {
        const zone: ArtifactZone = EDGE_PACKAGES.has(name) ? 'edge' : 'regional';
        if (target?.kind === 'channel' && typeof target.channel === 'string') {
          packages[name] = { version: target.channel, zone, channel: target.channel };
        } else if (target?.kind === 'release' && typeof target.version === 'string') {
          packages[name] = { version: target.version, zone };
        }
      }
    }
    return new PinnedResolver(scope, packages, bucketBase, s3VersionMap);
  }

  resolve(packageName: string, objectPath: string, _region: string): ResolvedArtifact {
    this.packageRegistry.validatePackage(packageName);
    return this.inner.resolve(packageName, objectPath);
  }

  registerPackages(names: string[]): void {
    this.packageRegistry.registerPackages(names);
  }

  getVersion(packageName: string): string {
    return this.inner.getVersion(packageName);
  }

  getBucketBase(): string {
    return this.inner.getBucketBase();
  }
}

/**
 * THE single place Lambda Code / S3 URL / ARN / version are built from a resolved artifact.
 * Wraps ANY IArtifactResolver (PinnedResolver default, AutoUpdater for tracking, or a dev-only
 * ChannelResolver in infrastructure/). Tracking is transparent: getCode/getUrl/getArn funnel
 * through resolver.resolve(), so an AutoUpdater makes them all track-aware with no engine change.
 * Region defaults to the deployment region; edge callers pass 'us-east-1'.
 */
export class CdkArtifactEngine implements ICdkArtifactEngine {
  private readonly bucketCache = new Map<string, IBucket>();
  private readonly versionSource: PinnedResolver;
  private readonly bucketScope: Construct;

  constructor(
    private readonly scope: IConstruct,
    private readonly resolver: IArtifactResolver,
    id: string = 'artifacts',
  ) {
    this.versionSource = PinnedResolver.loadFromArtifactMetadata(scope);
    // Create a child scope to namespace bucket imports and avoid construct-id collisions
    // when multiple engines (e.g. main + pinned) coexist under the same parent scope.
    this.bucketScope = new Construct(scope, id);
  }

  private regionOr(region?: string): string {
    return region ?? Stack.of(this.scope).region;
  }

  getCode(packageName: string, objectPath: string, region?: string): Code {
    const resolved = this.resolver.resolve(packageName, objectPath, this.regionOr(region));
    if (!this.bucketCache.has(packageName)) {
      this.bucketCache.set(
        packageName,
        Bucket.fromBucketName(this.bucketScope, `Bucket-${packageName}`, resolved.bucket),
      );
    }
    return Code.fromBucket(this.bucketCache.get(packageName)!, resolved.key, resolved.versionId);
  }

  getUrl(packageName: string, objectPath: string, region?: string): string {
    const r = this.regionOr(region);
    const resolved = this.resolver.resolve(packageName, objectPath, r);
    return buildArtifactUrl(resolved.bucket, r, resolved.key, resolved.versionId);
  }

  getArn(packageName: string, objectPath: string, region?: string): string {
    const resolved = this.resolver.resolve(packageName, objectPath, this.regionOr(region));
    return buildArtifactArn(resolved.bucket, resolved.key);
  }

  getVersion(packageName: string): string {
    return this.versionSource.getVersion(packageName);
  }

  getBucketBase(): string {
    return this.versionSource.getBucketBase();
  }

  resolve(packageName: string, objectPath: string, region?: string): ResolvedArtifact {
    return this.resolver.resolve(packageName, objectPath, this.regionOr(region));
  }

  registerPackages(names: string[]): void {
    // If the underlying resolver supports registerPackages, call it.
    // This allows constructs to self-register their packages before resolution.
    const resolver = this.resolver as ResolverWithOptionalPackageRegistration;
    resolver.registerPackages?.(names);
  }
}
