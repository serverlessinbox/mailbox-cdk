import type { IGrantable } from 'aws-cdk-lib/aws-iam';

/**
 * A bucket that static content is deployed into. It names itself and grants a deployer the S3 access
 * a deployment into it needs, scoped by the bucket's own ARN and the key patterns the deployment writes.
 * Not responsible for reading the content's source; that access belongs to the deployer.
 */
export interface IStaticContentTarget {
  readonly bucketName: string;

  /** Grants `grantee` `s3:PutObject` and `s3:DeleteObject` on the objects matching `keyPatterns`. */
  grantContentWrite(grantee: IGrantable, keyPatterns: string[]): void;

  /** Grants `grantee` `s3:ListBucket` on the whole bucket, which a deployment that replaces a prefix needs. */
  grantContentListing(grantee: IGrantable): void;
}
