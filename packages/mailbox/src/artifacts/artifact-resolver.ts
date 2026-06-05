import { Code } from 'aws-cdk-lib/aws-lambda';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Stack } from 'aws-cdk-lib';
import { Construct, IConstruct } from 'constructs';

/**
 * A specific published version.
 */
export interface ReleaseTarget {
  readonly kind: 'release';
  readonly version: string;
}

/**
 * A mutable channel (e.g. "dev", "stable").
 */
export interface ChannelTarget {
  readonly kind: 'channel';
  readonly channel: string;
}

/**
 * A semver track pointer resolved at synth time via CDK context.
 * Examples: "1.x" (latest of major 1) or "1.2.x" (latest of 1.2.x patch series).
 *
 * Resolution requires a context key `mailbox-track:<packageName>:<track>` in cdk.context.json.
 * Run the following to populate it before synthesising:
 *
 * ```sh
 * TRACK=1.x PACKAGE=mailbox-go
 * VERSION=$(aws s3 cp s3://mailbox-artifacts-eu-west-1/packages/${PACKAGE}/v1/latest-stable.json - | jq -r .version)
 * # then add to cdk.context.json: { "mailbox-track:${PACKAGE}:${TRACK}": "${VERSION}" }
 * ```
 */
export interface TrackTarget {
  readonly kind: 'track';
  /** Semver track, e.g. "1.x" or "1.2.x" */
  readonly track: string;
}

export type PublishTarget = ReleaseTarget | ChannelTarget | TrackTarget;

/**
 * Interface for resolving pre-published artifact locations.
 * Constructs depend on this interface, not the implementation.
 */
export interface IArtifactResolver {
  /**
   * Get Lambda Code for a package artifact.
   * @param packageName - Package name (e.g., 'mailbox-go')
   * @param objectPath - Object path within the package (e.g., 'lambdas/handler.zip')
   */
  getCode(packageName: string, objectPath: string): Code;

  /**
   * Get S3 URL for a package artifact.
   * @param packageName - Package name
   * @param objectPath - Object path
   * @param region - Optional region override
   */
  getUrl(packageName: string, objectPath: string, region?: string): string;

  /**
   * Get S3 ARN for a package artifact.
   * @param packageName - Package name
   * @param objectPath - Object path
   */
  getArn(packageName: string, objectPath: string): string;

  /**
   * Get S3 version ID for a package artifact from the version map.
   * Returns undefined if no version ID is configured for the artifact.
   * @param packageName - Package name
   * @param objectPath - Object path
   */
  getVersionId(packageName: string, objectPath: string): string | undefined;

  /**
   * Get the S3 key (full path) for a package artifact.
   * @param packageName - Package name
   * @param objectPath - Object path
   */
  getKey(packageName: string, objectPath: string): string;
}

/**
 * Configuration for ArtifactResolver.
 */
export interface ArtifactResolverConfig {
  /**
   * Artifact bucket base name (e.g. 'mailbox-artifacts').
   * Defaults to 'mailbox-artifacts'.
   */
  readonly bucketBase?: string;

  /**
   * Per-package targets: { packageName: target }
   */
  readonly packages: { [key: string]: PublishTarget };

  /**
   * AWS region. Defaults to stack region.
   */
  readonly region?: string;

  /**
   * Optional pre-computed version ID map for channels.
   * Structure: { "packages/packageName/channels/channelName/objectPath": "versionId" }
   * Used for versioned URLs in channels (from offline manifest).
   */
  readonly versionMap?: { [key: string]: string };
}

/**
 * Resolves pre-published artifact locations from S3.
 * Pure data structure—no AWS SDK calls. Versioning is handled offline via manifest.
 */
export class ArtifactResolver extends Construct implements IArtifactResolver {
  readonly bucketBase: string;
  readonly packages: Record<string, PublishTarget>;
  readonly region: string;
  readonly versionMap: Record<string, string>;
  private bucketCache = new Map<string, IBucket>();

  constructor(scope: IConstruct, config: ArtifactResolverConfig) {
    super(scope, 'ArtifactResolver');

    const stack = Stack.of(scope);

    this.bucketBase = config.bucketBase ?? 'mailbox-artifacts';
    this.packages = config.packages;
    this.region = config.region ?? stack.region;
    this.versionMap = config.versionMap ?? {};

    if (!this.packages || Object.keys(this.packages).length === 0) {
      throw new Error('At least one package target must be provided');
    }
  }

  /**
   * Get the bucket name for a region.
   */
  private bucketName(region?: string): string {
    const r = region ?? this.region;
    return `${this.bucketBase}-${r}`;
  }

  /**
   * Get or create bucket reference (cached per package to avoid duplicate construct IDs).
   */
  private getBucket(packageName: string): IBucket {
    if (!this.bucketCache.has(packageName)) {
      const bucket = Bucket.fromBucketName(
        this,
        `Bucket-${packageName}`,
        this.bucketName(),
      );
      this.bucketCache.set(packageName, bucket);
    }
    return this.bucketCache.get(packageName)!;
  }

  /**
   * Resolve a track specifier ("1.x" or "1.2.x") to a concrete version string
   * by reading from CDK context.
   *
   * The context key `mailbox-track:<packageName>:<track>` must be present in
   * cdk.context.json (or passed via `-c`). If absent, a descriptive error is
   * thrown at synth time with instructions for populating the value.
   *
   * Track-to-S3-path mapping:
   *   "1.x"   -> packages/<pkg>/v1/latest-stable.json
   *   "1.2.x" -> packages/<pkg>/v1.2/latest-stable.json
   */
  private resolveTrack(packageName: string, track: string): string {
    const contextKey = `mailbox-track:${packageName}:${track}`;
    const cached = this.node.tryGetContext(contextKey);
    if (cached) {
      return cached as string;
    }

    // Compute the S3 path so we can show it in the error message.
    const trackPath = track.replace(/\.x$/, '');
    const s3Prefix = `v${trackPath}`;
    const s3Key = `packages/${packageName}/${s3Prefix}/latest-stable.json`;
    const bucket = `${this.bucketBase}-${this.region}`;

    throw new Error(
      `Track "${track}" for package "${packageName}" is not resolved.\n` +
      `Add the resolved version to cdk.context.json:\n` +
      `  1. Fetch the latest stable version:\n` +
      `     aws s3 cp s3://${bucket}/${s3Key} - | jq -r .version\n` +
      `  2. Add to cdk.context.json:\n` +
      `     { "${contextKey}": "<version>" }`,
    );
  }

  /**
   * Compute the S3 prefix for a package.
   */
  private getPrefix(packageName: string): string {
    const target = this.packages[packageName];
    if (!target) {
      throw new Error(`No target configured for package '${packageName}'`);
    }

    if (target.kind === 'release') {
      const version = target.version.trim();
      if (!version) {
        throw new Error('version is required when target.kind=release');
      }
      return `packages/${packageName}/v${version}`;
    } else if (target.kind === 'track') {
      const version = this.resolveTrack(packageName, target.track);
      return `packages/${packageName}/v${version}`;
    } else {
      const channel = target.channel.trim();
      if (!channel) {
        throw new Error('channel is required when target.kind=channel');
      }
      return `packages/${packageName}/channels/${channel}`;
    }
  }

  /**
   * Get the S3 key for an object.
   */
  getKey(packageName: string, objectPath: string): string {
    const prefix = this.getPrefix(packageName);
    return `${prefix}/${objectPath.replace(/^\/+/, '')}`;
  }

  /**
   * Get S3 URL, optionally with version ID from versionMap (for channels).
   */
  getUrl(packageName: string, objectPath: string, region?: string): string {
    const r = region ?? this.region;
    const bucket = this.bucketName(r);
    const key = this.getKey(packageName, objectPath);
    let url = `https://${bucket}.s3.${r}.amazonaws.com/${key}`;

    // Append version ID if available in versionMap
    const versionId = this.versionMap[key];
    if (versionId) {
      url += `?versionId=${versionId}`;
    }

    return url;
  }

  /**
   * Get S3 ARN for an object.
   */
  getArn(packageName: string, objectPath: string): string {
    const bucket = this.bucketName();
    const key = this.getKey(packageName, objectPath);
    return `arn:aws:s3:::${bucket}/${key}`;
  }

  /**
   * Get S3 version ID for an artifact from the version map.
   */
  getVersionId(packageName: string, objectPath: string): string | undefined {
    const key = this.getKey(packageName, objectPath);
    return this.versionMap[key];
  }

  /**
   * Get Lambda Code for an object.
   * Constructs use this to wire Lambda code from artifacts.
   */
  getCode(packageName: string, objectPath: string): Code {
    const bucket = this.getBucket(packageName);
    const key = this.getKey(packageName, objectPath);

    // For versioned buckets (especially channels), pin the Lambda to a specific
    // S3 object version when we have it. Without this, CloudFormation may not
    // update Lambda code when the key stays the same but contents change.
    const versionId = this.versionMap[key];
    return Code.fromBucket(bucket, key, versionId);
  }
}
