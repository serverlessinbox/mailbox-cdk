import { Bucket, BucketProps, IBucket } from 'aws-cdk-lib/aws-s3';
import { Aws, IResolvable, Fn, Lazy, Stack, Token } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { getStackNameBase } from './stack-name-base-registry';

export interface INamedBucket extends IBucket {
  readonly explicitBucketName: string;
}

export interface StackNamedBucketProps extends BucketProps {
  /** Optional S3-safe base for bucket names (replaces Aws.STACK_NAME when provided) */
  readonly nameBase?: string | IResolvable;
}

export class StackNamedBucket extends Bucket implements INamedBucket {
  readonly explicitBucketName: string;

  constructor(scope: Construct, bucketName: string, props?: StackNamedBucketProps) {
    const constructId = bucketName;
    const stack = Stack.of(scope);

    // Use provided nameBase, or defer to registry lookup at synth time via Lazy
    const nameBase: string | IResolvable = (props?.nameBase && props.nameBase !== '')
      ? props.nameBase
      : Lazy.string({
          produce: () => {
            const registered = getStackNameBase(stack);
            return registered ? Token.asString(registered) : Aws.STACK_NAME;
          },
        });

    // Build bucket name using Fn.join to support IResolvable values
    const fullBucketName = Fn.join('', [Aws.ACCOUNT_ID, '-', Token.asString(nameBase), '-', bucketName]);

    super(scope, constructId, { ...props, bucketName: fullBucketName });

    this.explicitBucketName = fullBucketName;
  }
}
