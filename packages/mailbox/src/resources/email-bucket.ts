import { BlockPublicAccess, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { StackNamedBucket } from "../utils/named-bucket";
import { autoDeleteObjectsInDevelopment, isDevelopmentMode, removalPolicyForRetainedResources } from "../utils/development-mode";
import type * as kms from 'aws-cdk-lib/aws-kms';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';

export interface EmailBucketProps {
  /**
   * Optional explicit bucket encryption setting.
   * If omitted, defaults to SSE-KMS (AWS-managed) unless an encryptionKey is provided.
   */
  readonly encryption?: BucketEncryption;

  /** Optional customer-managed CMK to use for SSE-KMS. */
  readonly encryptionKey?: kms.IKey;
}

export class EmailBucket extends StackNamedBucket {
  constructor(scope: Construct, props: EmailBucketProps = {}) {
    const dev = isDevelopmentMode(scope);

    super(scope, 'email-bucket', {
      versioned: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: props.encryption
        ?? (props.encryptionKey ? BucketEncryption.KMS : BucketEncryption.KMS_MANAGED),
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
  }
}