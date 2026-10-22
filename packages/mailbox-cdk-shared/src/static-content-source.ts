import type { IBucket }                 from 'aws-cdk-lib/aws-s3';

import type { StaticContentSourceSpec } from './runtime/content-deployer/resource-properties';

/** HTTP metadata stored on an object written by a data source. */
export interface StaticContentWriteOptions {
  readonly contentType?:  string;
  readonly cacheControl?: string;
}

/** Options of a zip source. */
export interface StaticContentZipOptions {
  /** The version of the zip object to unpack. The latest version when omitted. */
  readonly sourceVersionId?: string;
}

/**
 * One source of static content: the value embedded in a deployment's custom resource, and the S3 object
 * keys and source ARNs that deploying it touches.
 */
export interface IStaticContentSource {
  /** The plain, CloudFormation-serializable value embedded in the custom resource's properties. */
  readonly spec: StaticContentSourceSpec;

  /** The key patterns of the objects this source writes into the target bucket. */
  readonly objectKeyPatterns: string[];

  /** The ARNs of the objects this source reads from. Absent for a source whose content is inline. */
  sourceArns?(): string[];
}

/** Factories for the sources of static content. */
export abstract class StaticContentSource {
  private constructor() {} // static factories only

  /** A literal write at an exact, known key. IAM is scoped to exactly this one object. */
  static data(key: string, body: string, options: StaticContentWriteOptions = {}): IStaticContentSource {
    return {
      spec:              { kind: 'data', key, body, ...options },
      objectKeyPatterns: [key],
    };
  }

  /**
   * A zip archive unpacked under `targetPrefix`. The keys the archive produces are unknown at synth
   * time, so IAM is scoped to a prefix wildcard.
   */
  static zipFromBucket(
    sourceBucket: IBucket,
    sourceKey: string,
    targetPrefix: string,
    options: StaticContentZipOptions = {},
  ): IStaticContentSource {
    const normalizedPrefix = targetPrefix.endsWith('/') ? targetPrefix : `${targetPrefix}/`;
    return {
      spec:              { kind: 'zip', sourceBucket: sourceBucket.bucketName, sourceKey, targetPrefix: normalizedPrefix, ...options },
      objectKeyPatterns: [`${normalizedPrefix}*`],
      sourceArns:        () => [sourceBucket.arnForObjects(sourceKey)],
    };
  }
}
