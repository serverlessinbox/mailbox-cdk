import { StackNamedBucket }      from '@serverlessinbox/mailbox-cdk-shared';
import { BlockPublicAccess }     from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy }         from 'aws-cdk-lib';
import { Construct }             from 'constructs';

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
}
