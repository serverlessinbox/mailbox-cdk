import type { IArtifactResolver }     from '@serverlessinbox/artifact-registry-cdk';
import * as iam                       from 'aws-cdk-lib/aws-iam';
import { IBucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { Stack, RemovalPolicy }       from 'aws-cdk-lib';
import { Construct }                  from 'constructs';

import { StackNamedBucket }           from './named-bucket';
import { BucketAutoEmpty }            from './resources/lambdas/bucket-auto-empty';
import { getOrCreateSharedGroup }     from './tagging/shared-group';

/**
 * Singleton construct for a shared, public S3 bucket used to store small public static assets
 * (discovery documents, metadata, config files) that multiple CDK constructs need to serve.
 *
 * The bucket itself is public by design (only holds public static documents per RFC 6749 / RFC 9728),
 * eliminating the need for one dedicated bucket per static-asset-serving construct.
 *
 * Singleton pattern: only one per Stack. The bucket is placed under a "shared" group construct
 * at stack root, and BucketAutoEmpty is attached once (centrally, here) to clean up on stack deletion.
 */
export class PublicStaticAssetsBucket {
  private static readonly BUCKET_ID = 'public-static-assets';

  /**
   * Get-or-create the one shared public static assets bucket for this Stack.
   * Returns it as IBucket (no construct instance type-check needed).
   * BucketAutoEmpty is wired once, centrally, inside this method.
   */
  static getOrCreate(scope: Construct, artifactResolver: IArtifactResolver): IBucket {
    const stack       = Stack.of(scope);
    const sharedGroup = getOrCreateSharedGroup(stack);

    // Try to find an existing bucket by its construct ID.
    const existing = sharedGroup.node.tryFindChild(PublicStaticAssetsBucket.BUCKET_ID);
    if (existing instanceof StackNamedBucket) {
      return existing;
    }

    // Create the bucket with stack-derived name and public-by-design ACL settings
    const bucket = new StackNamedBucket(sharedGroup, PublicStaticAssetsBucket.BUCKET_ID, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Attach BucketAutoEmpty once, centrally, for cleanup on stack deletion
    BucketAutoEmpty.getOrCreate(sharedGroup, artifactResolver).attach(sharedGroup, 'public-assets-auto-empty', bucket);

    // Grant public read access to all objects in this bucket (it only holds public static docs by convention)
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
