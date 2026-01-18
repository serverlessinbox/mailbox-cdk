import { Code } from 'aws-cdk-lib/aws-lambda';
import { Bucket, IBucket } from 'aws-cdk-lib/aws-s3';
import { Stack } from 'aws-cdk-lib';
import { Construct, IConstruct } from 'constructs';

export type PublishTarget =
  | {
    kind: 'release';
    version: string;
  }
  | {
    kind: 'channel';
    channel: string;
  };

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
  bucketBase?: string;

  /**
   * Per-package targets: { packageName: target }
   */
  packages: Record<string, PublishTarget>;

  /**
   * AWS region. Defaults to stack region.
   */
  region?: string;

  /**
   * Optional pre-computed version ID map for channels.
   * Structure: { "packages/packageName/channels/channelName/objectPath": "versionId" }
   * Used for versioned URLs in channels (from offline manifest).
   */
  versionMap?: Record<string, string>;
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
