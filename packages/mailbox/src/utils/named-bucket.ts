import { Bucket, BucketProps, IBucket } from 'aws-cdk-lib/aws-s3';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface INamedBucket extends IBucket {
  readonly explicitBucketName: string;
}

export class StackNamedBucket extends Bucket implements INamedBucket {
  readonly explicitBucketName: string;

  constructor(scope: Construct, bucketName: string, props?: BucketProps) {
    const stack = Stack.of(scope);
    const fullBucketName = `${stack.account}-${stack.stackName}-${bucketName}`;
    super(scope, fullBucketName, {
      ...props,
      bucketName: fullBucketName,
    });

    this.explicitBucketName = fullBucketName;
  }
}
