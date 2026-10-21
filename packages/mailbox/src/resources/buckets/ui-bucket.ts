import { StackNamedBucket }            from '@serverlessinbox/mailbox-cdk-shared';
import { IPrincipal, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess }           from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy }               from 'aws-cdk-lib';
import { Construct }                   from 'constructs';

/**
 * The static-content bucket behind one UI's CloudFront distribution.
 *
 * Fully private, destroyed with the stack, and created with ABAC enabled.
 */
export class UiBucket extends StackNamedBucket {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      abacStatus: true,
    });
  }

  /**
   * Allows `principal` to read individual objects through the bucket's resource policy. `s3:GetObject`
   * only: listing the bucket is not granted.
   */
  grantObjectReadTo(principal: IPrincipal): void {
    this.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [this.arnForObjects('*')],
        principals: [principal],
      }),
    );
  }
}
