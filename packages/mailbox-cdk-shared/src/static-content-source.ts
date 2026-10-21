import type { IBucket }                 from 'aws-cdk-lib/aws-s3';

import type { StaticContentSourceSpec } from './runtime/content-deployer/resource-properties';

/** HTTP metadata stored on an object written by a data source. */
export interface StaticContentWriteOptions {
  readonly contentType?: string;
  readonly cacheControl?: string;
}

/** Options of a zip source. */
export interface StaticContentZipOptions {
  /** The version of the zip object to unpack. The latest version when omitted. */
  readonly sourceVersionId?: string;
}

/**
 * One source of static content: the value embedded in a deployment's custom resource, and the S3 object
 * ARNs that deploying it touches.
 */
export interface IStaticContentSource {
  /** The plain, CloudFormation-serializable value embedded in the custom resource's properties. */
  readonly spec: StaticContentSourceSpec;

  /**
   * The ARNs of the objects this source writes into `bucket`, for `s3:PutObject` and `s3:DeleteObject`.
   * Bucket-level `s3:ListBucket` is not covered.
   */
  objectArns(bucket: IBucket): string[];

  /** The ARNs of the objects this source reads from. Absent for a source whose content is inline. */
  sourceArns?(): string[];
}

/** Creates the sources of a `StaticContentDeployer`. */
export abstract class StaticContentSource {
  private constructor() {} // static factories only

  /** A literal write at an exact, known key. IAM is scoped to exactly this one object ARN. */
  static data(key: string, body: string, options: StaticContentWriteOptions = {}): IStaticContentSource {
    return {
      spec: { kind: 'data', key, body, ...options },
      objectArns: (bucket) => [bucket.arnForObjects(key)],
    };
  }

  /**
   * A zip archive unpacked under `targetPrefix`. `sourceBucketName` is a plain name rather than an
   * `IBucket`: the artifact bucket the zip comes from is external to the stack. The keys the archive
   * produces are unknown at synth time, so IAM is scoped to a prefix wildcard.
   */
  static zipFromBucket(
    sourceBucketName: string,
    sourceKey: string,
    targetPrefix: string,
    options: StaticContentZipOptions = {},
  ): IStaticContentSource {
    const normalizedPrefix = targetPrefix.endsWith('/') ? targetPrefix : `${targetPrefix}/`;
    return {
      spec: { kind: 'zip', sourceBucket: sourceBucketName, sourceKey, targetPrefix: normalizedPrefix, ...options },
      objectArns: (bucket) => [bucket.arnForObjects(`${normalizedPrefix}*`)],
      sourceArns: () => [`arn:aws:s3:::${sourceBucketName}/${sourceKey}`],
    };
  }
}
