import { Bucket, BucketProps, IBucket } from 'aws-cdk-lib/aws-s3';
import * as cdk from 'aws-cdk-lib';
import { Aws, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { sanitizeStackName } from './sanitize-name';

export interface INamedBucket extends IBucket {
  readonly explicitBucketName: string;
}

export interface StackNamedBucketProps extends BucketProps {
  /** Optional S3-safe base for bucket names (replaces Aws.STACK_NAME when provided) */
  readonly s3NameBase?: string | cdk.IResolvable;
}

export class StackNamedBucket extends Bucket implements INamedBucket {
  readonly explicitBucketName: string;

  constructor(scope: Construct, bucketName: string, props?: StackNamedBucketProps) {
    const stack = Stack.of(scope);
    const sanitizedStackName = sanitizeStackName(stack.stackName);
    const constructId = cdk.Token.isUnresolved(stack.account)
      ? bucketName
      : `${stack.account}-${sanitizedStackName}-${bucketName}`;
    // Use provided s3NameBase, or fall back to Aws.STACK_NAME if not provided or empty string
    const s3NameBase = (props?.s3NameBase && props.s3NameBase !== '') ? props.s3NameBase : Aws.STACK_NAME;
    const fullBucketName = `${Aws.ACCOUNT_ID}-${s3NameBase}-${bucketName}`;
    super(scope, constructId, { ...props, bucketName: fullBucketName });

    this.explicitBucketName = fullBucketName;
  }
}
