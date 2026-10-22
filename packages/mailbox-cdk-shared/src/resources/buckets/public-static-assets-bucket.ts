import type { IArtifactResolver }     from '@serverlessinbox/artifact-registry-cdk';
import * as iam                       from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess }          from 'aws-cdk-lib/aws-s3';
import { Stack, RemovalPolicy }       from 'aws-cdk-lib';
import { Construct }                  from 'constructs';

import { getOrCreateSharedGroup }     from '../../tagging/shared-group';
import { BucketAutoEmpty }            from '../lambdas/bucket-auto-empty';

import { StackNamedBucket }           from './named-bucket';
import type { IStaticContentTarget }  from './static-content-target';

/** The stack's public static assets bucket: a target for static content, plus the domain its documents are served from. */
export interface IPublicStaticAssetsBucket extends IStaticContentTarget {
  readonly bucketRegionalDomainName: string;
}

/**
 * The one public S3 bucket per Stack that holds small public static documents. The bucket is public by
 * design: it only holds documents that are public per RFC 6749 / RFC 9728, which removes the need for a
 * dedicated bucket per static-document-serving construct, so it grants anyone `s3:GetObject` and nothing else.
 *
 * It sits under the stack's "shared" group construct, next to the `BucketAutoEmpty` attachment that empties
 * it on stack deletion.
 */
export class PublicStaticAssetsBucket extends StackNamedBucket implements IPublicStaticAssetsBucket {
  private static readonly BUCKET_ID = 'public-static-assets';

  private constructor(sharedGroup: Construct, artifactResolver: IArtifactResolver) {
    super(sharedGroup, PublicStaticAssetsBucket.BUCKET_ID, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS_ONLY,
      removalPolicy:     RemovalPolicy.DESTROY,
    });

    BucketAutoEmpty.getOrCreate(sharedGroup, artifactResolver).attach(sharedGroup, 'public-assets-auto-empty', this);

    this.addToResourcePolicy(
      new iam.PolicyStatement({
        actions:    ['s3:GetObject'],
        principals: [new iam.AnyPrincipal()],
        resources:  [this.arnForObjects('*')],
      }),
    );
  }

  /** Returns the stack's public static assets bucket, creating it on the first call. */
  static getOrCreate(scope: Construct, artifactResolver: IArtifactResolver): IPublicStaticAssetsBucket {
    const sharedGroup = getOrCreateSharedGroup(Stack.of(scope));

    const existing = sharedGroup.node.tryFindChild(PublicStaticAssetsBucket.BUCKET_ID);
    if (existing instanceof PublicStaticAssetsBucket) {
      return existing;
    }

    return new PublicStaticAssetsBucket(sharedGroup, artifactResolver);
  }
}
