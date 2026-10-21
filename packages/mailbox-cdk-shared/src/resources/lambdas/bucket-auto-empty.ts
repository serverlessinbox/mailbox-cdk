import type { IArtifactResolver }                 from '@serverlessinbox/artifact-registry-cdk';
import * as iam                                   from 'aws-cdk-lib/aws-iam';
import { IBucket }                                from 'aws-cdk-lib/aws-s3';
import { Duration, CustomResource, Stack }        from 'aws-cdk-lib';
import { Construct }                              from 'constructs';

import { getOrCreateSharedGroup }                 from '../../tagging/shared-group';
import type { BucketAutoEmptyResourceProperties } from '../../ts-lambdas/bucket-auto-empty/resource-properties';

import { TypeScriptLambda }                       from './ts-lambda';

/**
 * Empties S3 buckets when the stack is deleted, so that a bucket with `RemovalPolicy.DESTROY` can be
 * torn down while it still holds objects. One shared Lambda per stack serves every attached bucket.
 */
export class BucketAutoEmpty extends TypeScriptLambda {
  private constructor(scope: Construct, id: string, artifactResolver: IArtifactResolver) {
    super(scope, id, {
      lambdaId: 'bucket-auto-empty',
      pipeline: 'infra',
      artifactResolver,
      packageName: 'mailbox-cdk-shared',
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 512,
    });

    this.grantParentStackStatusRead();
  }

  /**
   * Get-or-create the one shared bucket-auto-empty Lambda for this Stack.
   * The singleton is placed under a "shared" group construct at stack root.
   */
  static getOrCreate(scope: Construct, artifactResolver: IArtifactResolver): BucketAutoEmpty {
    const stack       = Stack.of(scope);
    const sharedGroup = getOrCreateSharedGroup(stack);
    const existing    = sharedGroup.node.tryFindChild('bucket-auto-empty');
    if (existing instanceof BucketAutoEmpty) {
      return existing;
    }
    return new BucketAutoEmpty(sharedGroup, 'bucket-auto-empty', artifactResolver);
  }

  /**
   * Empties `bucket` when the stack is deleted. The custom resource refers to the bucket by name, so
   * CloudFormation deletes it before the bucket itself.
   */
  attach(scope: Construct, id: string, bucket: IBucket): void {
    if (!this.role) {
      throw new Error('BucketAutoEmpty.attach: Lambda has no execution role to grant on');
    }

    // The bucket grants live in their own AWS::IAM::Policy, never in the role's shared DefaultPolicy.
    // On rollback CloudFormation reverts an updated DefaultPolicy before it invokes this resource's
    // Delete, which then fails with AccessDenied and leaves the bucket undeletable.
    const policy = new iam.Policy(scope, `${id}-policy`, {
      roles: [this.role],
      statements: [
        new iam.PolicyStatement({
          actions: ['s3:ListBucket', 's3:ListBucketVersions'],
          resources: [bucket.bucketArn],
        }),
        new iam.PolicyStatement({
          actions: ['s3:DeleteObject', 's3:DeleteObjectVersion'],
          resources: [bucket.arnForObjects('*')],
        }),
      ],
    });

    const properties: BucketAutoEmptyResourceProperties = { bucketName: bucket.bucketName };
    const resource                                      = new CustomResource(scope, id, {
      serviceToken: this.functionArn,
      serviceTimeout: Duration.minutes(15),
      resourceType: 'Custom::BucketAutoEmpty',
      properties,
    });

    // The resource's Delete empties the bucket, so it must run before the policy that authorizes it is deleted.
    resource.node.addDependency(policy);
  }

  private grantParentStackStatusRead(): void {
    const stack = Stack.of(this);
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [stack.stackId],
      }),
    );
  }
}
