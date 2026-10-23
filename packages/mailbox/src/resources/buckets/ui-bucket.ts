import { StackNamedBucket }                   from '@serverlessinbox/mailbox-cdk-shared';
import { S3BucketOrigin }                     from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  IOrigin,
  IOriginAccessControl,
  S3OriginAccessControl,
} from 'aws-cdk-lib/aws-cloudfront';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy }     from 'aws-cdk-lib';
import { Construct }         from 'constructs';

/**
 * The static-content bucket behind one UI's CloudFront distribution.
 *
 * Fully private, destroyed with the stack, and created with ABAC enabled. It is the S3 side of the
 * UI's distribution: it hands out the two origins that read it through Origin Access Control and the
 * grant that lets a deployer write the static content.
 *
 * Binding either origin to a distribution makes CDK add a statement to this bucket's policy: that
 * distribution, and only that one (an `AWS:SourceArn` condition on its ARN), may `s3:GetObject` every
 * object in the bucket. No other principal can read the bucket's objects.
 */
export class UiBucket extends StackNamedBucket {
  private readonly originAccessControl: IOriginAccessControl;

  constructor(scope: Construct, id: string) {
    super(scope, id, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy:     RemovalPolicy.DESTROY,
      abacStatus:        true,
    });

    this.originAccessControl = new S3OriginAccessControl(this, 'origin-access-control');
  }

  /** The origin serving the UI bundle from the `/content` prefix. */
  contentOrigin(): IOrigin {
    return S3BucketOrigin.withOriginAccessControl(this, {
      originAccessControl: this.originAccessControl,
      originPath:          '/content',
    });
  }

  /** The origin serving the runtime config from the bucket root, so `/config/*` maps to the `config/` prefix. */
  configOrigin(): IOrigin {
    return S3BucketOrigin.withOriginAccessControl(this, {
      originAccessControl: this.originAccessControl,
      originPath:          '',
    });
  }

  /**
   * Grants `grantee` exactly the S3 actions needed to deploy static content into this bucket:
   * `s3:PutObject`/`s3:DeleteObject` on the `content/` and `config/` prefixes, and `s3:ListBucket`
   * scoped to list only those prefixes.
   *
   * The grant is scoped by this bucket's ARN and key patterns, never by tag: `aws:ResourceTag`
   * reads the still-untagged object being written, and `s3:BucketTag` is not honored for
   * `PutObject` even though it is listed as a supported condition key on the S3 `object`
   * resource type. A tag condition on these actions therefore denies the write.
   */
  grantContentDeploy(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:PutObject', 's3:DeleteObject'],
      resourceArns: [this.arnForObjects('content/*')],
    });
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:PutObject', 's3:DeleteObject'],
      resourceArns: [this.arnForObjects('config/*')],
    });
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:ListBucket'],
      resourceArns: [this.bucketArn],
      conditions:   { StringLike: { 's3:prefix': 'content/*' } },
    });
    Grant.addToPrincipal({
      grantee,
      actions:      ['s3:ListBucket'],
      resourceArns: [this.bucketArn],
      conditions:   { StringLike: { 's3:prefix': 'config/*' } },
    });
  }
}
