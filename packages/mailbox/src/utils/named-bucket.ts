import { Bucket, BucketProps, IBucket } from 'aws-cdk-lib/aws-s3';
import { Aws, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { sanitizeStackName } from './sanitize-name';

export interface INamedBucket extends IBucket {
  readonly explicitBucketName: string;
}

export class StackNamedBucket extends Bucket implements INamedBucket {
  readonly explicitBucketName: string;

  constructor(scope: Construct, bucketName: string, props?: BucketProps) {
    const stack = Stack.of(scope);
    const sanitizedStackName = sanitizeStackName(stack.stackName);
    const constructId = stack.account === '000000000000'
      ? bucketName
      : `${stack.account}-${sanitizedStackName}-${bucketName}`;
    const fullBucketName = `${Aws.ACCOUNT_ID}-${Aws.STACK_NAME}-${bucketName}`;
    super(scope, constructId, { ...props, bucketName: fullBucketName });

    this.explicitBucketName = fullBucketName;
  }
}
