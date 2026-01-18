import { BlockPublicAccess, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { StackNamedBucket } from "../utils/named-bucket";
import { autoDeleteObjectsInDevelopment, isDevelopmentMode, removalPolicyForRetainedResources } from "../utils/development-mode";

export class EmailBucket extends StackNamedBucket {
  constructor(scope: Construct) {
    const dev = isDevelopmentMode(scope);

    super(scope, 'email-bucket', {
      versioned: false,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
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
  }
}