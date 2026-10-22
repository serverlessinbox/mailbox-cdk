import type { IArtifactResolver }     from '@serverlessinbox/artifact-registry-cdk';
import * as iam                       from 'aws-cdk-lib/aws-iam';
import { IBucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { Stack, RemovalPolicy }       from 'aws-cdk-lib';
import { Construct }                  from 'constructs';

import { getOrCreateSharedGroup }     from '../../tagging/shared-group';
import { BucketAutoEmpty }            from '../lambdas/bucket-auto-empty';

import { StackNamedBucket }           from './named-bucket';

/**
 * Accessor for the one public S3 bucket per Stack that holds small public static documents. The
 * bucket is public by design: it only holds documents that are public per RFC 6749 / RFC 9728, which
 * removes the need for a dedicated bucket per static-document-serving construct.
 *
 * The bucket sits under the stack's "shared" group construct, and its `BucketAutoEmpty` is attached
 * once, in the same call that creates the bucket, so the bucket is emptied on stack deletion.
 */
export class PublicStaticAssetsBucket {
  private static readonly BUCKET_ID = 'public-static-assets';

  /**
   * Returns the stack's public static assets bucket, creating it with its auto-empty and its
   * public-read policy on the first call.
   */
  static getOrCreate(scope: Construct, artifactResolver: IArtifactResolver): IBucket {
    const stack       = Stack.of(scope);
    const sharedGroup = getOrCreateSharedGroup(stack);

    const existing = sharedGroup.node.tryFindChild(PublicStaticAssetsBucket.BUCKET_ID);
    if (existing instanceof StackNamedBucket) {
      return existing;
    }

    const bucket = new StackNamedBucket(sharedGroup, PublicStaticAssetsBucket.BUCKET_ID, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    BucketAutoEmpty.getOrCreate(sharedGroup, artifactResolver).attach(sharedGroup, 'public-assets-auto-empty', bucket);

    // Public read is intended: the bucket only holds public static documents.
    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        principals: [new iam.AnyPrincipal()],
        resources: [bucket.arnForObjects('*')],
      }),
    );

    return bucket;
  }
}
