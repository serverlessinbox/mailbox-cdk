import { Construct } from 'constructs';
import { Duration, CustomResource, Stack } from 'aws-cdk-lib';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { ICdkArtifactEngine } from './artifact-engine';
import { TypeScriptLambda } from './ts-lambda';
import { getOrCreateSharedGroup } from './shared-group';

/**
 * A dedicated construct for emptying S3 buckets on CloudFormation stack deletion.
 *
 * When a bucket has `RemovalPolicy.DESTROY`, CloudFormation cannot delete it if it contains objects.
 * This construct provides a CustomResource that, on Delete, lists and batch-deletes all objects and
 * versions, allowing the bucket to be torn down cleanly.
 *
 * Create/Update are pure no-ops — all work happens in Delete when the stack is being torn down.
 *
 * Singleton pattern: only one per Stack.
 */
export class BucketAutoEmpty extends TypeScriptLambda {
  private readonly attachments = new Map<Construct, CustomResource[]>();

  /**
   * Get-or-create the one shared bucket-auto-empty Lambda for this Stack.
   * The singleton is placed under a "shared" group construct at stack root.
   */
  static getOrCreate(scope: Construct, artifactResolver: ICdkArtifactEngine): BucketAutoEmpty {
    const stack = Stack.of(scope);
    const sharedGroup = getOrCreateSharedGroup(stack);
    const existing = sharedGroup.node.tryFindChild('bucket-auto-empty');
    if (existing instanceof BucketAutoEmpty) {
      return existing;
    }
    return new BucketAutoEmpty(sharedGroup, 'bucket-auto-empty', artifactResolver);
  }

  private constructor(scope: Construct, id: string, artifactResolver: ICdkArtifactEngine) {
    // Must register the package BEFORE calling super(), which will try to resolve.
    // Idempotent (Set-backed).
    artifactResolver.registerPackages(['mailbox-cdk-shared']);

    super(scope, id, {
      lambdaId: 'bucket-auto-empty',
      pipeline: 'infra',
      artifactResolver,
      packageName: 'mailbox-cdk-shared',
      handler: 'index.handler',
      timeout: Duration.minutes(15),
      memorySize: 512,
    });

    // Grant permission to check parent stack rollback status during custom-resource Update failures.
    this.grantParentStackStatusRead();
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

  /**
   * Attach this bucket-emptier to a specific bucket.
   *
   * Creates a CustomResource that, on stack Delete, will list and batch-delete all objects
   * and versions in the bucket. The CustomResource implicitly depends on the bucket (via
   * the embedded bucketName reference), so it will be deleted before the bucket itself.
   *
   * The method automatically grants the required S3 permissions:
   * - s3:ListBucket and s3:ListBucketVersions on the bucket
   * - s3:DeleteObject and s3:DeleteObjectVersion on all objects within the bucket
   *
   * Returns the CustomResource so it can be explicitly depended on if needed.
   */
  attach(scope: Construct, id: string, bucket: IBucket): CustomResource {
    if (!this.role) {
      throw new Error('BucketAutoEmpty.attach: Lambda has no execution role to grant on');
    }

    // These grants MUST live in their own AWS::IAM::Policy resource, NOT in the Lambda role's
    // shared DefaultPolicy via addToRolePolicy(). DefaultPolicy already exists across updates, so
    // adding a statement to it is an UPDATE of an existing resource — and on a rollback CFN reverts
    // that update to the prior document and *then* invokes this CustomResource's Delete. The
    // handler is left without the permission the rollback is asking it to use:
    //   "not authorized to perform: s3:ListBucketVersions" → CR Delete FAILED
    //   → "The bucket you tried to delete is not empty" (409) → rollback stalls.
    // There is no ordering handle for an updated resource, so the fix is a dedicated Policy that is
    // CREATED and DELETED alongside this attachment, plus an explicit dependency below so CFN tears
    // the CustomResource down BEFORE the policy that authorizes it.
    // Do NOT "simplify" this back to addToRolePolicy().
    const policy = new iam.Policy(scope, `${id}-policy`, {
      roles: [this.role],
      statements: [
        // Enumerate every object and (if the bucket is versioned) every version.
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

    // Create the CustomResource.
    // Embedding bucket.bucketName in properties creates an implicit CFN dependency
    // (via Ref) — the CustomResource is created before the bucket and deleted after.
    const resource = new CustomResource(scope, id, {
      serviceToken: this.functionArn,
      serviceTimeout: Duration.minutes(15),
      resourceType: 'Custom::BucketAutoEmpty',
      properties: {
        bucketName: bucket.bucketName,
      },
    });

    // Deletion order is the whole point: CFN deletes dependents first, so the CustomResource's
    // Delete (which empties the bucket) runs while `policy` is still in place.
    resource.node.addDependency(policy);

    // Track attachments by scope for potential future coordination
    const tracked = this.attachments.get(scope) ?? [];
    tracked.push(resource);
    this.attachments.set(scope, tracked);

    return resource;
  }
}
