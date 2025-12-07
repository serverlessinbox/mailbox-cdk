import { BlockPublicAccess, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Duration, RemovalPolicy } from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { StackNamedBucket } from "../utils/named-bucket";

export class EmailBucket extends StackNamedBucket {
  constructor(scope: Construct) {
    super(scope, 'email-bucket', {
      versioned: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
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
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE, // For development - use RETAIN in production
    });
  }
}