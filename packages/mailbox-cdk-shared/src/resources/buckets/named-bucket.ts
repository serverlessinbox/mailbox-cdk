import { Grant, IGrantable }                        from 'aws-cdk-lib/aws-iam';
import { Bucket, BucketProps }                      from 'aws-cdk-lib/aws-s3';
import { Aws, IResolvable, Fn, Lazy, Stack, Token } from 'aws-cdk-lib';
import { Construct, IConstruct }                    from 'constructs';

import { getStackNameBase }                         from '../../naming/stack-name-base-registry';

import type { IStaticContentTarget }                from './static-content-target';

/** Props for {@link StackNamedBucket}: the S3 bucket props plus an optional replacement for the stack name in the bucket name. */
export interface StackNamedBucketProps extends BucketProps {
  /** Optional S3-safe base for bucket names (replaces Aws.STACK_NAME when provided) */
  readonly nameBase?: string | IResolvable;
}

/**
 * A {@link Bucket} with the explicit physical name `<account>-<nameBase>-<bucketName>`, where `nameBase`
 * is the prop, else the S3-safe base registered via `setStackNameBase` for the stack, else the stack name.
 *
 * Not responsible for choosing the name base; the caller passes `nameBase` or registers one.
 */
export class StackNamedBucket extends Bucket implements IStaticContentTarget {
  constructor(scope: Construct, bucketName: string, props?: StackNamedBucketProps) {
    const constructId = bucketName;

    // Use provided nameBase, or defer to the shared registry-backed prefix
    const prefix: string = (props?.nameBase && props.nameBase !== '')
      ? Fn.join('', [Aws.ACCOUNT_ID, '-', Token.asString(props.nameBase), '-'])
      : StackNamedBucket.resolveBucketNamePrefix(scope);

    const fullBucketName = Fn.join('', [prefix, bucketName]);

    super(scope, constructId, { ...props, bucketName: fullBucketName });
  }

  grantContentWrite(grantee: IGrantable, keyPatterns: string[]): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:PutObject', 's3:DeleteObject'],
      resourceArns: keyPatterns.map((keyPattern) => this.arnForObjects(keyPattern)),
    });
  }

  grantContentListing(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:ListBucket'],
      resourceArns: [this.bucketArn],
    });
  }

  /**
   * The synth-time bucket-name prefix (`${accountId}-${nameBase}-`), where `nameBase` is the S3-safe
   * base registered via `setStackNameBase` for this stack, falling back to `Aws.STACK_NAME` when nothing
   * is registered.
   *
   * Wrapped in `Lazy` because a bucket may be constructed before whichever construct in the stack calls
   * `setStackNameBase` — the registry lookup happens at synth time, once construction of the whole tree
   * has completed.
   */
  private static resolveBucketNamePrefix(scope: IConstruct): string {
    const stack = Stack.of(scope);
    return Lazy.string({
      produce: () => {
        const registered = getStackNameBase(stack);
        const nameBase   = registered ? Token.asString(registered) : Aws.STACK_NAME;
        return Fn.join('', [Aws.ACCOUNT_ID, '-', nameBase, '-']);
      },
    });
  }
}
