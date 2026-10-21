import { StackNamedBucket }                                                                     from '@serverlessinbox/mailbox-cdk-shared';
import { autoDeleteObjectsInDevelopment, isDevelopmentMode, removalPolicyForRetainedResources } from '@serverlessinbox/mailbox-cdk-shared';
import { Effect, PolicyStatement, ServicePrincipal }                                            from 'aws-cdk-lib/aws-iam';
import type * as kms                                                                            from 'aws-cdk-lib/aws-kms';
import { BlockPublicAccess, BucketEncryption, LifecycleRule }                                   from 'aws-cdk-lib/aws-s3';
import { Aws, Duration, RemovalPolicy, Stack, IResolvable }                                     from 'aws-cdk-lib';
import { Construct }                                                                            from 'constructs';

export interface BlobStoreProps {
  /** Optional customer-managed CMK to use for SSE-KMS. */
  readonly encryptionKey?: kms.IKey;
  /** Optional stack name base used for resource naming (replaces Aws.STACK_NAME when provided) */
  readonly nameBase?: string | IResolvable;
}

/**
 * Durable mail storage, contacts, principals, and search indexes.
 *
 * Stores email objects, contact cards, principals, search indexes, and temporary uploads across tenants. Inbound mail is staged in a dedicated prefix for processing before permanent storage.
 *
 * **Object layout**
 *
 * | Prefix | Contents |
 * |--------|----------|
 * | `tenants/{tenant}/accounts/{account}/emails/{emailID}/` | Durable email storage: raw MIME (`original.eml`), `body.txt`, `body.html`, inline parts and attachments |
 * | `tenants/{tenant}/accounts/{account}/contacts/` | Contact cards |
 * | `tenants/{tenant}/principals/` | Principal objects |
 * | `tenants/{tenant}/accounts/{account}/search-indexes/` | Search indexes |
 * | `uploads/{tenant}/{account}/{blobID}` | Temporary client uploads; expire after 1 day |
 * | `incoming-emails/` | Inbound mail staging |
 *
 * **Access**
 * - Writes: JMAP API, admin API, email processor, SES event processor, identity provisioner
 * - Reads only: email sender
 * - Service principals: SES writes `incoming-emails/*` (per bucket policy); CloudFront reads `tenants/*` only (via origin access control).
 *
 * **Lifecycle**
 * - Object versioning enabled in production; disabled in development.
 * - Incoming emails expire after 7 days.
 * - Uploaded blobs expire after 1 day.
 * - Noncurrent versions expire after 35 days in production.
 * - Delete markers cleaned up in production.
 *
 * **Encryption**
 * - S3-managed by default; customer-managed CMK supported via `encryptionKey` prop.
 */
export class BlobStore extends StackNamedBucket {
  /** Key prefix under which inbound mail is staged; the lifecycle rule, the SES write grant and the receipt rule all use it. */
  public static readonly INCOMING_EMAIL_PREFIX = 'incoming-emails/';

  constructor(scope: Construct, props: BlobStoreProps = {}) {
    const dev = isDevelopmentMode(scope);

    const lifecycleRules: LifecycleRule[] = [
      {
        id: 'DeleteUnhandledIncomingEmails',
        prefix: BlobStore.INCOMING_EMAIL_PREFIX,
        enabled: true,
        expiration: Duration.days(7), // Delete emails after 7 days
      },
      {
        id: 'DeleteUploadedBlobs',
        prefix: 'uploads/',
        enabled: true,
        expiration: Duration.days(1), // Delete temporary client uploads after 1 day
      },
    ];

    // Add noncurrent version expiration (35 days) and delete marker cleanup.
    // Versioning keeps old versions forever unless explicitly expired.
    if (!dev) {
      lifecycleRules.push(
        {
          id: 'DeleteNoncurrentVersions',
          enabled: true,
          noncurrentVersionExpiration: Duration.days(35),
        },
        {
          id: 'DeleteExpiredObjectDeleteMarkers',
          enabled: true,
          expiredObjectDeleteMarker: true,
        },
      );
    }

    super(scope, 'blob-store', {
      versioned: !dev,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: props.encryptionKey ? BucketEncryption.KMS : BucketEncryption.S3_MANAGED,
      encryptionKey: props.encryptionKey,
      nameBase: props.nameBase,
      autoDeleteObjects: autoDeleteObjectsInDevelopment(scope),
      lifecycleRules,
      removalPolicy: dev ? RemovalPolicy.DESTROY : removalPolicyForRetainedResources(scope),
    });

    this.grantS3UseOfEncryptionKey(props.encryptionKey);
    this.grantSesInboundDelivery();
    this.grantCloudFrontBlobRead();
  }

  private grantS3UseOfEncryptionKey(encryptionKey: kms.IKey | undefined): void {
    // Best-effort: if a customer-managed key is provided, allow S3 to use it for SSE-KMS on
    // this bucket. On an imported key, addToResourcePolicy is a silent no-op (allowNoOp
    // defaults to true), so in that case the user must configure the key policy themselves.
    encryptionKey?.addToResourcePolicy(
      new PolicyStatement({
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        principals: [new ServicePrincipal('s3.amazonaws.com')],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': Stack.of(this).account,
          },
          ArnLike: {
            'aws:SourceArn': this.bucketArn,
          },
        },
      })
    );
  }

  private grantSesInboundDelivery(): void {
    // Allow SES to write inbound emails to this bucket.
    // This policy must live here (on the owned bucket) because the main mailbox stack
    // references the bucket via Bucket.fromBucketArn (an imported IBucket), and
    // addToResourcePolicy on imported buckets is a CDK no-op.
    this.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal('ses.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [`${this.bucketArn}/${BlobStore.INCOMING_EMAIL_PREFIX}*`],
        conditions: {
          StringEquals: {
            'aws:Referer': Aws.ACCOUNT_ID,
          },
        },
      }),
    );
  }

  private grantCloudFrontBlobRead(): void {
    // Allow CloudFront (OAC) to read blobs from this bucket.
    // The CDN construct uses origins.S3BucketOrigin.withOriginAccessControl() and receives
    // this bucket as an imported IBucket — CDK's grantRead on an imported bucket is a no-op
    // for the bucket resource policy, so we must add the grant here on the owned bucket.
    // We scope by account (not distribution ARN) because the distribution lives in the main
    // stack and its ARN is not known at data-stack deploy time.
    // Scoped to tenants/* only, because constructS3Key() returns only tenants/ prefixes;
    // uploads/* and incoming-emails/* are never legitimately CloudFront-servable.
    this.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [`${this.bucketArn}/tenants/*`],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': Aws.ACCOUNT_ID,
          },
        },
      }),
    );
  }
}
