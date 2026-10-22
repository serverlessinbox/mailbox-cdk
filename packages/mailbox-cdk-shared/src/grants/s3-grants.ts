import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { IBucket }           from 'aws-cdk-lib/aws-s3';

const READ   = ['s3:GetObject'] as const;
const WRITE  = ['s3:PutObject'] as const;
const DELETE = ['s3:DeleteObject'] as const;

/**
 * Explicit least-privilege S3 object action sets — `read`, `write`, `delete`, and their
 * compositions — for use with `grantObjectActions`. Kept separate from CDK's
 * `Bucket.grantRead`/`grantWrite`/`grantReadWrite`/`grantPut`/`grantDelete`: those grant a broader
 * action set (e.g. `grantRead` also allows `s3:GetBucket*` and `s3:List*`). There is no
 * `s3:HeadObject` IAM action — `HeadObject` calls are authorized by `s3:GetObject`, so `read`
 * covers both.
 */
export const S3Actions = {
  read: READ,
  write: WRITE,
  delete: DELETE,
  readWrite: [...READ, ...WRITE],
  readWriteDelete: [...READ, ...WRITE, ...DELETE],
  readDelete: [...READ, ...DELETE],
} as const;

/** One S3 object action of the sets in {@link S3Actions}. */
export type S3Action = typeof READ[number] | typeof WRITE[number] | typeof DELETE[number];

/**
 * Grants a caller exactly the given S3 actions on objects matching `keyPattern`. Scoped to
 * `bucket.arnForObjects(keyPattern)` — never the bucket ARN itself, so this can't be used to grant
 * bucket-level actions like `s3:ListBucket`; use `grantListBucket` for that. If the bucket uses a
 * customer-managed KMS key (`encryptionKey`), also grants the matching key actions, so a caller
 * granted S3 object actions never needs to reason about the bucket's encryption separately from its
 * object actions.
 */
export function grantObjectActions(grantee: IGrantable, bucket: IBucket, actions: readonly S3Action[], keyPattern: string): Grant {
  const grant = Grant.addToPrincipal({
    grantee,
    actions: [...actions],
    resourceArns: [bucket.arnForObjects(keyPattern)],
  });

  // Grant KMS key access if the bucket uses a customer-managed key for SSE-KMS.
  // S3 PutObject with CMK requires kms:GenerateDataKey* to mint a data key and kms:DescribeKey.
  // S3 GetObject with CMK requires kms:Decrypt and kms:DescribeKey.
  // DeleteObject does not require KMS permissions (deletion does not use the key).
  const key = bucket.encryptionKey;
  if (key) {
    const kmsActions: string[] = [];

    if (actions.includes('s3:PutObject')) {
      kmsActions.push('kms:GenerateDataKey*');
    }

    if (actions.includes('s3:GetObject')) {
      kmsActions.push('kms:Decrypt');
    }

    // DescribeKey is needed for any use of the key.
    if (kmsActions.length > 0) {
      kmsActions.push('kms:DescribeKey');
      key.grant(grantee, ...kmsActions);
    }
  }

  return grant;
}

/**
 * Grants a caller `s3:ListBucket` on `bucket` itself, restricted with a `StringLike` condition on
 * `s3:prefix` so the grantee can only list keys matching `prefixPattern` — never the whole bucket.
 * `s3:ListBucket` authorizes against the bucket ARN, not an object ARN, which is why this is a
 * separate function from `grantObjectActions`.
 */
export function grantListBucket(grantee: IGrantable, bucket: IBucket, prefixPattern: string): Grant {
  return Grant.addToPrincipal({
    grantee,
    actions: ['s3:ListBucket'],
    resourceArns: [bucket.bucketArn],
    conditions: {
      StringLike: {
        's3:prefix': prefixPattern,
      },
    },
  });
}
