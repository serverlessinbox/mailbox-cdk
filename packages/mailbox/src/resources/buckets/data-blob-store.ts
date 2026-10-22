import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { IBucket }           from 'aws-cdk-lib/aws-s3';

import { BlobStore }         from './blob-store';

/**
 * A handle to the blob store's bucket, given instead of a raw CDK `IBucket`. Use it to read the
 * bucket's name and to grant exactly the object actions one blob access pattern needs on a specific
 * key prefix — never to reach the underlying bucket for anything else, since none is exposed.
 */
export interface IDataBlobStore {
  /** The bucket's physical name, as CloudFormation assigns it. */
  readonly bucketName: string;

  /** Grants `grantee` `s3:PutObject` on the per-account email-blob key prefix. */
  grantEmailBlobWrite(grantee: IGrantable): void;

  /** Grants `grantee` `s3:GetObject` on the per-account email-blob key prefix. */
  grantEmailBlobRead(grantee: IGrantable): void;

  /**
   * Grants `grantee` `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject` on the per-account email-blob
   * key prefix, plus `s3:ListBucket` scoped to that same prefix, so a whole prefix can be listed and
   * deleted.
   */
  grantEmailBlobReadWriteDelete(grantee: IGrantable): void;

  /** Grants `grantee` `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject` on the uploads key prefix. */
  grantUploadBlobReadWriteDelete(grantee: IGrantable): void;

  /** Grants `grantee` `s3:GetObject`/`s3:DeleteObject` on the incoming-emails key prefix: read a raw message, then delete it. */
  grantIncomingEmailConsume(grantee: IGrantable): void;

  /** Grants `grantee` `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject` on the per-account contact-blob key prefix. */
  grantContactBlobReadWriteDelete(grantee: IGrantable): void;

  /** Grants `grantee` `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject` on the per-tenant principal-blob key prefix. */
  grantPrincipalBlobReadWriteDelete(grantee: IGrantable): void;

  /** Grants `grantee` `s3:GetObject` on the per-account search-index key prefix. */
  grantSearchIndexRead(grantee: IGrantable): void;

  /** Grants `grantee` `s3:GetObject`/`s3:PutObject` on the per-account search-index key prefix. */
  grantSearchIndexReadWrite(grantee: IGrantable): void;
}

/**
 * Wraps a bucket reference and narrows what a consumer can do with it. Not responsible for creating,
 * importing or configuring the bucket. A plain class, not a construct: it adds no node of its own to
 * the construct tree and synthesizes nothing.
 *
 * Each grant lists its S3 actions rather than using CDK's `Bucket.grantRead`/`grantWrite`, which also
 * allow `s3:GetBucket*` and `s3:List*`. `HeadObject` is authorized by `s3:GetObject`; there is no
 * `s3:HeadObject` action. When the bucket has a customer-managed key, a grant adds the key actions its
 * S3 actions need: `kms:GenerateDataKey*` for `PutObject`, `kms:Decrypt` for `GetObject`, and
 * `kms:DescribeKey` for either. `DeleteObject` does not use the key.
 */
export class DataBlobStore implements IDataBlobStore {
  private static readonly EMAIL_BLOB_KEY_PATTERN     = 'tenants/*/accounts/*/emails/*';
  private static readonly UPLOAD_BLOB_KEY_PATTERN    = 'uploads/*';
  private static readonly INCOMING_EMAIL_KEY_PATTERN = `${BlobStore.INCOMING_EMAIL_PREFIX}*`;
  private static readonly CONTACT_BLOB_KEY_PATTERN   = 'tenants/*/accounts/*/contacts/*';
  private static readonly PRINCIPAL_BLOB_KEY_PATTERN = 'tenants/*/principals/*';
  private static readonly SEARCH_INDEX_KEY_PATTERN   = 'tenants/*/accounts/*/search-indexes/*';

  public readonly bucketName: string;

  constructor(private readonly bucket: IBucket) {
    this.bucketName = bucket.bucketName;
  }

  public grantEmailBlobWrite(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:PutObject'],
      resourceArns: [this.bucket.arnForObjects(DataBlobStore.EMAIL_BLOB_KEY_PATTERN)],
    });
    this.bucket.encryptionKey?.grant(grantee, 'kms:GenerateDataKey*', 'kms:DescribeKey');
  }

  public grantEmailBlobRead(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:GetObject'],
      resourceArns: [this.bucket.arnForObjects(DataBlobStore.EMAIL_BLOB_KEY_PATTERN)],
    });
    this.bucket.encryptionKey?.grant(grantee, 'kms:Decrypt', 'kms:DescribeKey');
  }

  public grantEmailBlobReadWriteDelete(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resourceArns: [this.bucket.arnForObjects(DataBlobStore.EMAIL_BLOB_KEY_PATTERN)],
    });
    this.bucket.encryptionKey?.grant(grantee, 'kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey');
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:ListBucket'],
      resourceArns: [this.bucket.bucketArn],
      conditions:   { StringLike: { 's3:prefix': DataBlobStore.EMAIL_BLOB_KEY_PATTERN } },
    });
  }

  public grantUploadBlobReadWriteDelete(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resourceArns: [this.bucket.arnForObjects(DataBlobStore.UPLOAD_BLOB_KEY_PATTERN)],
    });
    this.bucket.encryptionKey?.grant(grantee, 'kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey');
  }

  public grantIncomingEmailConsume(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:GetObject', 's3:DeleteObject'],
      resourceArns: [this.bucket.arnForObjects(DataBlobStore.INCOMING_EMAIL_KEY_PATTERN)],
    });
    this.bucket.encryptionKey?.grant(grantee, 'kms:Decrypt', 'kms:DescribeKey');
  }

  public grantContactBlobReadWriteDelete(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resourceArns: [this.bucket.arnForObjects(DataBlobStore.CONTACT_BLOB_KEY_PATTERN)],
    });
    this.bucket.encryptionKey?.grant(grantee, 'kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey');
  }

  public grantPrincipalBlobReadWriteDelete(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resourceArns: [this.bucket.arnForObjects(DataBlobStore.PRINCIPAL_BLOB_KEY_PATTERN)],
    });
    this.bucket.encryptionKey?.grant(grantee, 'kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey');
  }

  public grantSearchIndexRead(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:GetObject'],
      resourceArns: [this.bucket.arnForObjects(DataBlobStore.SEARCH_INDEX_KEY_PATTERN)],
    });
    this.bucket.encryptionKey?.grant(grantee, 'kms:Decrypt', 'kms:DescribeKey');
  }

  public grantSearchIndexReadWrite(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:GetObject', 's3:PutObject'],
      resourceArns: [this.bucket.arnForObjects(DataBlobStore.SEARCH_INDEX_KEY_PATTERN)],
    });
    this.bucket.encryptionKey?.grant(grantee, 'kms:GenerateDataKey*', 'kms:Decrypt', 'kms:DescribeKey');
  }
}
