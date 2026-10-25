import { StackNamedBucket }                                   from '@serverlessinbox/mailbox-cdk-shared';
import { Effect, PolicyStatement, ServicePrincipal }          from 'aws-cdk-lib/aws-iam';
import type * as kms                                          from 'aws-cdk-lib/aws-kms';
import { BlockPublicAccess, BucketEncryption, LifecycleRule } from 'aws-cdk-lib/aws-s3';
import { Aws, Duration, RemovalPolicy, IResolvable }          from 'aws-cdk-lib';
import { Construct }                                          from 'constructs';

/** Encryption configuration for the blob store. */
export interface BlobStoreEncryptionProps {
  /** Optional customer-managed CMK to use for SSE-KMS. */
  readonly encryptionKey?: kms.IKey;
}

export interface BlobStoreProps extends BlobStoreEncryptionProps {
  /** Optional stack name base used for resource naming (replaces Aws.STACK_NAME when provided) */
  readonly nameBase?: string | IResolvable;

  /** Development mode: no versioning, no noncurrent-version lifecycle rules, and objects are deleted with the bucket. */
  readonly developmentMode: boolean;

  /** What happens to the bucket when its stack is updated or deleted. */
  readonly removalPolicy: RemovalPolicy;
}

/**
 * The data tier's S3 bucket: email objects, contact cards, principals, search indexes, client uploads
 * and inbound mail staging, for all tenants. Encrypted with S3-managed keys, or with SSE-KMS under the
 * customer-managed key when one is given.
 */
export class BlobStore extends StackNamedBucket {
  /** Key prefix under which inbound mail is staged; the lifecycle rule, the SES write grant and the receipt rule all use it. */
  public static readonly INCOMING_EMAIL_PREFIX = 'incoming-emails/';

  constructor(scope: Construct, props: BlobStoreProps) {
    const lifecycleRules: LifecycleRule[] = [
      {
        id:         'DeleteUnhandledIncomingEmails',
        prefix:     BlobStore.INCOMING_EMAIL_PREFIX,
        enabled:    true,
        expiration: Duration.days(7),
      },
      {
        id:         'DeleteUploadedBlobs',
        prefix:     'uploads/',
        enabled:    true,
        expiration: Duration.days(1),
      },
    ];

    // Versioning keeps old versions forever unless explicitly expired.
    if (!props.developmentMode) {
      lifecycleRules.push(
        {
          id:                          'DeleteNoncurrentVersions',
          enabled:                     true,
          noncurrentVersionExpiration: Duration.days(35),
        },
        {
          id:                        'DeleteExpiredObjectDeleteMarkers',
          enabled:                   true,
          expiredObjectDeleteMarker: true,
        },
      );
    }

    super(scope, 'blob-store', {
      versioned:         !props.developmentMode,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL:        true,
      encryption:        props.encryptionKey ? BucketEncryption.KMS : BucketEncryption.S3_MANAGED,
      encryptionKey:     props.encryptionKey,
      nameBase:          props.nameBase,
      autoDeleteObjects: props.developmentMode,
      lifecycleRules,
      removalPolicy:     props.removalPolicy,
    });

    this.grantS3UseOfEncryptionKey(props.encryptionKey);
    this.grantSesInboundDelivery();
    this.grantCloudFrontBlobRead();
  }

  /**
   * Writes a statement onto the customer's key policy, which this bucket cannot reach through a narrow
   * interface. On an imported key `addToResourcePolicy` is a silent no-op (`allowNoOp` defaults to true),
   * so the key policy of an imported key must be configured by its owner.
   */
  private grantS3UseOfEncryptionKey(encryptionKey: kms.IKey | undefined): void {
    encryptionKey?.addToResourcePolicy(
      new PolicyStatement({
        actions:    [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        principals: [new ServicePrincipal('s3.amazonaws.com')],
        resources:  ['*'],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': Aws.ACCOUNT_ID,
          },
          ArnLike:      {
            'aws:SourceArn': this.bucketArn,
          },
        },
      })
    );
  }

  private grantSesInboundDelivery(): void {
    this.addToResourcePolicy(
      new PolicyStatement({
        effect:     Effect.ALLOW,
        principals: [new ServicePrincipal('ses.amazonaws.com')],
        actions:    ['s3:PutObject'],
        resources:  [`${this.bucketArn}/${BlobStore.INCOMING_EMAIL_PREFIX}*`],
        conditions: {
          StringEquals: {
            'aws:Referer': Aws.ACCOUNT_ID,
          },
        },
      }),
    );
  }

  /**
   * Scoped by account because the distribution's ARN is not known when this bucket is created, and to
   * `tenants/*` because `uploads/*` and `incoming-emails/*` are never served through CloudFront.
   */
  private grantCloudFrontBlobRead(): void {
    this.addToResourcePolicy(
      new PolicyStatement({
        effect:     Effect.ALLOW,
        principals: [new ServicePrincipal('cloudfront.amazonaws.com')],
        actions:    ['s3:GetObject'],
        resources:  [`${this.bucketArn}/tenants/*`],
        conditions: {
          StringEquals: {
            'aws:SourceAccount': Aws.ACCOUNT_ID,
          },
        },
      }),
    );
  }
}
