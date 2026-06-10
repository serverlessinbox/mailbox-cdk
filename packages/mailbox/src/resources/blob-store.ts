import { BlockPublicAccess, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Aws, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { StackNamedBucket } from "../utils/named-bucket";
import { autoDeleteObjectsInDevelopment, isDevelopmentMode, removalPolicyForRetainedResources } from "../utils/development-mode";
import type * as kms from 'aws-cdk-lib/aws-kms';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';

export interface BlobStoreProps {
  /** Optional customer-managed CMK to use for SSE-KMS. */
  readonly encryptionKey?: kms.IKey;
}

export class BlobStore extends StackNamedBucket {
  constructor(scope: Construct, props: BlobStoreProps = {}) {
    const dev = isDevelopmentMode(scope);

    super(scope, 'blob-store', {
      versioned: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: props.encryptionKey ? BucketEncryption.KMS : BucketEncryption.S3_MANAGED,
      encryptionKey: props.encryptionKey,
      autoDeleteObjects: autoDeleteObjectsInDevelopment(scope),
      lifecycleRules: [
        {
          id: 'DeleteUnhandledIncomingEmails',
          prefix: 'incoming-emails/',
          enabled: true,
          expiration: Duration.days(7), // Delete emails after 7 days
        },
        {
          id: 'DeleteUploadedBlobs',
          prefix: 'blobs/',
          enabled: true,
          expiration: Duration.days(1), // Delete uploaded blobs after 1 day
        },
      ],
      removalPolicy: dev ? RemovalPolicy.DESTROY : removalPolicyForRetainedResources(scope),
    });

    // Best-effort: if a customer-managed key is provided and it supports resource policy edits,
    // allow S3 to use the key for SSE-KMS on this bucket.
    // (Imported keys may not support policy edits; in that case the user must configure the key policy themselves.)
    const keyAny = props.encryptionKey as unknown as { addToResourcePolicy?: (s: PolicyStatement) => unknown };
    if (props.encryptionKey && typeof keyAny?.addToResourcePolicy === 'function') {
      keyAny.addToResourcePolicy(
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

    // Allow SES to write inbound emails to this bucket.
    // This policy must live here (on the owned bucket) because the main mailbox stack
    // references the bucket via Bucket.fromBucketArn (an imported IBucket), and
    // addToResourcePolicy on imported buckets is a CDK no-op.
    this.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal('ses.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [`${this.bucketArn}/incoming-emails/*`],
        conditions: {
          StringEquals: {
            'aws:Referer': Aws.ACCOUNT_ID,
          },
        },
      }),
    );
  }
}
