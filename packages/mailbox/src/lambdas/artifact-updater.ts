import { TypeScriptLambda, ServerlessInboxTagKeys, rootStackResourceTagConditions } from '@serverlessinbox/mailbox-cdk-shared';
import type { RootStack } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Aws, Duration } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { Granularity } from '../artifacts/resolvers/auto-updater';

export interface ArtifactUpdaterLambdaProps {
  artifactResolver: IArtifactResolver;
  distTag: string;
  granularity: Granularity;
  rootStackTagValue: string;
  rootStackId: string;
  artifactBucketBase: string;
}

/**
 * The Lambda that moves a stack's tagged artifacts to newer releases. Its role holds every grant the
 * update needs, each scoped to the root stack by tag wherever the service honours the tag.
 */
export class ArtifactUpdaterLambda extends TypeScriptLambda {
  private static readonly project = 'serverlessinbox';
  private static readonly anyFunctionArn = `arn:aws:lambda:*:${Aws.ACCOUNT_ID}:function:*`;
  private static readonly anyDistributionArn = `arn:aws:cloudfront::${Aws.ACCOUNT_ID}:distribution/*`;

  constructor(scope: Construct, id: string, props: ArtifactUpdaterLambdaProps) {
    super(scope, id, {
      lambdaId: 'artifact-updater',
      pipeline: 'infra',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        ARTIFACT_BUCKET_BASE: props.artifactBucketBase,
        DIST_TAG: props.distTag,
        GRANULARITY: props.granularity,
        PROJECT: ArtifactUpdaterLambda.project,
        ROOT_STACK_TAG_VALUE: props.rootStackTagValue,
        ROOT_STACK_ID: props.rootStackId,
      },
    });

    const owner: RootStack = { name: props.rootStackTagValue, id: props.rootStackId };
    // No grant on UI buckets: S3 object writes cannot be scoped by tag, so a bucket's own ARN is the only scope.
    this.grantTagDiscovery();
    this.grantLambdaManagementAccess(owner);
    this.grantLambdaTagAccess(owner);
    this.grantEdgeLambdaAccess(owner);
    this.grantCloudFrontManagementAccess(owner);
    this.grantCloudFrontTagAccess(owner);
    this.grantArtifactReleaseAccess(props.artifactBucketBase);
    this.grantParentStackStatusRead();
    this.grantSelfInvoke();
  }

  /** GetResources is read-only enumeration and cannot be scoped. */
  private grantTagDiscovery(): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['tag:GetResources'],
        resources: ['*'],
      }),
    );
  }

  private grantLambdaManagementAccess(owner: RootStack): void {
    for (const conditions of rootStackResourceTagConditions(owner)) {
      this.addToRolePolicy(
        new PolicyStatement({
          actions: ['lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:UpdateFunctionCode', 'lambda:InvokeFunction'],
          resources: [ArtifactUpdaterLambda.anyFunctionArn],
          conditions,
        }),
      );
    }
  }

  private grantLambdaTagAccess(owner: RootStack): void {
    this.grantArtifactVersionTagging('lambda:TagResource', ArtifactUpdaterLambda.anyFunctionArn, owner);
  }

  /** Edge functions are always in us-east-1. */
  private grantEdgeLambdaAccess(owner: RootStack): void {
    for (const conditions of rootStackResourceTagConditions(owner)) {
      this.addToRolePolicy(
        new PolicyStatement({
          actions: ['lambda:GetFunctionConfiguration', 'lambda:PublishVersion'],
          resources: [`arn:aws:lambda:us-east-1:${Aws.ACCOUNT_ID}:function:*`],
          conditions,
        }),
      );
    }
  }

  /** The CloudFront distribution resource type supports `aws:ResourceTag`, so distributions are scoped by the root-stack tags. */
  private grantCloudFrontManagementAccess(owner: RootStack): void {
    for (const conditions of rootStackResourceTagConditions(owner)) {
      this.addToRolePolicy(
        new PolicyStatement({
          actions: ['cloudfront:GetDistributionConfig', 'cloudfront:UpdateDistribution', 'cloudfront:CreateInvalidation'],
          resources: [ArtifactUpdaterLambda.anyDistributionArn],
          conditions,
        }),
      );
    }
  }

  private grantCloudFrontTagAccess(owner: RootStack): void {
    this.grantArtifactVersionTagging('cloudfront:TagResource', ArtifactUpdaterLambda.anyDistributionArn, owner);
  }

  private grantArtifactReleaseAccess(artifactBucketBase: string): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${artifactBucketBase}-*/${ArtifactUpdaterLambda.project}/packages/*/releases/*`],
      }),
    );
  }

  /** Reads the status of the stack this function belongs to, to answer the deploy-end trigger correctly while that stack rolls back. */
  private grantParentStackStatusRead(): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [Aws.STACK_ID],
      }),
    );
  }

  private grantSelfInvoke(): void {
    this.addPermission('self-invoke', {
      principal: this.grantPrincipal,
      action: 'lambda:InvokeFunction',
    });
  }

  /**
   * Tag writes are limited to the artifact-version key, so the role cannot rewrite the root-stack tags
   * that scope its other grants or inject tags another policy trusts.
   */
  private grantArtifactVersionTagging(action: string, resourceArn: string, owner: RootStack): void {
    for (const conditions of rootStackResourceTagConditions(owner)) {
      this.addToRolePolicy(
        new PolicyStatement({
          actions: [action],
          resources: [resourceArn],
          conditions: {
            ...conditions,
            'ForAllValues:StringEquals': {
              'aws:TagKeys': [ServerlessInboxTagKeys.artifactVersion],
            },
          },
        }),
      );
    }
  }
}
