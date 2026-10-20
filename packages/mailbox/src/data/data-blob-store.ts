import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IGrantable } from 'aws-cdk-lib/aws-iam';
import { S3Actions, grantObjectActions, grantListBucket } from '@serverlessinbox/mailbox-cdk-shared';
import { BlobStore } from '../resources/blob-store';

const EMAIL_BLOB_KEY_PATTERN = 'tenants/*/accounts/*/emails/*';
const UPLOAD_BLOB_KEY_PATTERN = 'uploads/*';
const INCOMING_EMAIL_KEY_PATTERN = `${BlobStore.INCOMING_EMAIL_PREFIX}*`;
const CONTACT_BLOB_KEY_PATTERN = 'tenants/*/accounts/*/contacts/*';
const PRINCIPAL_BLOB_KEY_PATTERN = 'tenants/*/principals/*';
const SEARCH_INDEX_KEY_PATTERN = 'tenants/*/accounts/*/search-indexes/*';

/**
 * A handle to the data sub-stack's S3 blob store, given to code outside that sub-stack instead of
 * a raw CDK `IBucket`. Use it to read the bucket's name and to grant a Lambda exactly the object
 * actions it needs on a specific key prefix — never to reach the underlying bucket for anything
 * else, since none is exposed. Each grant method corresponds to one Go-side blob access pattern and
 * grants only the actions that pattern performs.
 */
export interface IDataBlobStore {
  /** The bucket's physical name, as CloudFormation assigns it. */
  readonly bucketName: string;

  /** Grants `grantee` `s3:PutObject` on the per-account email-blob key prefix — email ingestion writes. */
  grantEmailBlobWrite(grantee: IGrantable): void;

  /** Grants `grantee` `s3:GetObject` on the per-account email-blob key prefix — email body/attachment reads. */
  grantEmailBlobRead(grantee: IGrantable): void;

  /**
   * Grants `grantee` `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject` on the per-account email-blob
   * key prefix, plus `s3:ListBucket` scoped to that same prefix: the prefix-delete in
   * `EmailBlobStorage.DeleteEmail` lists before deleting, hence ListBucket.
   */
  grantEmailBlobReadWriteDelete(grantee: IGrantable): void;

  /** Grants `grantee` `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject` on the uploads key prefix — JMAP upload storage. */
  grantUploadBlobReadWriteDelete(grantee: IGrantable): void;

  /**
   * Grants `grantee` `s3:GetObject`/`s3:DeleteObject` on the incoming-emails key prefix — the
   * email-processor consumes (reads then deletes) each raw message SES delivered here.
   */
  grantIncomingEmailConsume(grantee: IGrantable): void;

  /**
   * Grants `grantee` `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject` on the per-account contact-blob
   * key prefix — contact blob storage.
   */
  grantContactBlobReadWriteDelete(grantee: IGrantable): void;

  /**
   * Grants `grantee` `s3:GetObject`/`s3:PutObject`/`s3:DeleteObject` on the per-tenant principal-blob
   * key prefix — principal blob storage.
   */
  grantPrincipalBlobReadWriteDelete(grantee: IGrantable): void;

  /**
   * Grants `grantee` `s3:GetObject` on the per-account search-index key prefix — the JMAP API reads
   * the built Tantivy index to serve search queries.
   */
  grantSearchIndexRead(grantee: IGrantable): void;

  /**
   * Grants `grantee` `s3:GetObject`/`s3:PutObject` on the per-account search-index key prefix — the
   * Tantivy indexer downloads the existing index, rebuilds it, and uploads the result.
   */
  grantSearchIndexReadWrite(grantee: IGrantable): void;
}

/**
 * Wraps a bucket imported (by ARN) from the data sub-stack. Not responsible for creating, importing
 * or configuring the bucket — `MailboxDataStackRef` owns the cross-stack import; this class only
 * narrows what a consumer can do with the resulting reference. A plain class, not a construct: it
 * adds no node of its own to the construct tree and synthesizes nothing.
 */
export class DataBlobStore implements IDataBlobStore {
  public readonly bucketName: string;

  constructor(private readonly bucket: IBucket) {
    this.bucketName = bucket.bucketName;
  }

  public grantEmailBlobWrite(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.write, EMAIL_BLOB_KEY_PATTERN);
  }

  public grantEmailBlobRead(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.read, EMAIL_BLOB_KEY_PATTERN);
  }

  public grantEmailBlobReadWriteDelete(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readWriteDelete, EMAIL_BLOB_KEY_PATTERN);
    grantListBucket(grantee, this.bucket, EMAIL_BLOB_KEY_PATTERN);
  }

  public grantUploadBlobReadWriteDelete(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readWriteDelete, UPLOAD_BLOB_KEY_PATTERN);
  }

  public grantIncomingEmailConsume(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readDelete, INCOMING_EMAIL_KEY_PATTERN);
  }

  public grantContactBlobReadWriteDelete(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readWriteDelete, CONTACT_BLOB_KEY_PATTERN);
  }

  public grantPrincipalBlobReadWriteDelete(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readWriteDelete, PRINCIPAL_BLOB_KEY_PATTERN);
  }

  public grantSearchIndexRead(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.read, SEARCH_INDEX_KEY_PATTERN);
  }

  public grantSearchIndexReadWrite(grantee: IGrantable): void {
    grantObjectActions(grantee, this.bucket, S3Actions.readWrite, SEARCH_INDEX_KEY_PATTERN);
  }
}
