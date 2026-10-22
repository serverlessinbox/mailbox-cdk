import { S3Actions, grantObjectActions, grantListBucket } from '@serverlessinbox/mailbox-cdk-shared';
import { IGrantable }                                     from 'aws-cdk-lib/aws-iam';
import { IBucket }                                        from 'aws-cdk-lib/aws-s3';

import { BlobStore }                                      from './blob-store';

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
    grantObjectActions(grantee, this.bucket, S3Actions.write, DataBlobStore.EMAIL_BLOB_KEY_PATTERN);
  }

  public grantEmailBlobRead(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.read, DataBlobStore.EMAIL_BLOB_KEY_PATTERN);
  }

  public grantEmailBlobReadWriteDelete(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readWriteDelete, DataBlobStore.EMAIL_BLOB_KEY_PATTERN);
    grantListBucket(grantee, this.bucket, DataBlobStore.EMAIL_BLOB_KEY_PATTERN);
  }

  public grantUploadBlobReadWriteDelete(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readWriteDelete, DataBlobStore.UPLOAD_BLOB_KEY_PATTERN);
  }

  public grantIncomingEmailConsume(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readDelete, DataBlobStore.INCOMING_EMAIL_KEY_PATTERN);
  }

  public grantContactBlobReadWriteDelete(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readWriteDelete, DataBlobStore.CONTACT_BLOB_KEY_PATTERN);
  }

  public grantPrincipalBlobReadWriteDelete(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readWriteDelete, DataBlobStore.PRINCIPAL_BLOB_KEY_PATTERN);
  }

  public grantSearchIndexRead(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.read, DataBlobStore.SEARCH_INDEX_KEY_PATTERN);
  }

  public grantSearchIndexReadWrite(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readWrite, DataBlobStore.SEARCH_INDEX_KEY_PATTERN);
  }
}
