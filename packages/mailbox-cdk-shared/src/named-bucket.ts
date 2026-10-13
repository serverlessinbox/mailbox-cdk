import { Bucket, BucketProps, IBucket } from 'aws-cdk-lib/aws-s3';
import { Aws, IResolvable, Fn, Lazy, Stack, Token } from 'aws-cdk-lib';
import { Construct, IConstruct } from 'constructs';
import { getStackNameBase } from './naming/stack-name-base-registry';

export interface INamedBucket extends IBucket {
  readonly explicitBucketName: string;
}

export interface StackNamedBucketProps extends BucketProps {
  /** Optional S3-safe base for bucket names (replaces Aws.STACK_NAME when provided) */
  readonly nameBase?: string | IResolvable;
}

/**
 * The synth-time bucket-name prefix (`${accountId}-${nameBase}-`) that StackNamedBucket uses to
 * build a bucket's physical name, where `nameBase` is the S3-safe base registered via
 * `setStackNameBase` for this stack, falling back to `Aws.STACK_NAME` when nothing is registered.
 *
 * Wrapped in `Lazy` because a caller of this function may be constructed before whichever construct
 * in the stack calls `setStackNameBase` — the registry lookup happens at synth time, once
 * construction of the whole tree has completed.
 */
function resolveBucketNamePrefix(scope: IConstruct): string {
  const stack = Stack.of(scope);
  return Lazy.string({
    produce: () => {
      const registered = getStackNameBase(stack);
      const nameBase = registered ? Token.asString(registered) : Aws.STACK_NAME;
      return Fn.join('', [Aws.ACCOUNT_ID, '-', nameBase, '-']);
    },
  });
}

export class StackNamedBucket extends Bucket implements INamedBucket {
  readonly explicitBucketName: string;

  constructor(scope: Construct, bucketName: string, props?: StackNamedBucketProps) {
    const constructId = bucketName;

    // Use provided nameBase, or defer to the shared registry-backed prefix
    const prefix: string = (props?.nameBase && props.nameBase !== '')
      ? Fn.join('', [Aws.ACCOUNT_ID, '-', Token.asString(props.nameBase), '-'])
      : resolveBucketNamePrefix(scope);

    const fullBucketName = Fn.join('', [prefix, bucketName]);

    super(scope, constructId, { ...props, bucketName: fullBucketName });

    this.explicitBucketName = fullBucketName;
  }
}
