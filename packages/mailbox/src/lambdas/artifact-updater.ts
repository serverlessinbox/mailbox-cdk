import { TypeScriptLambda, ServerlessInboxTagKeys, rootStackResourceTagCondition } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Aws, Duration } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { Granularity } from '../artifacts/resolvers/auto-updater';
import { ArtifactUpdaterEnvNames, type ArtifactUpdaterEnvName } from '../ts-lambdas/artifact-updater/env-names';

export interface ArtifactUpdaterLambdaProps {
  artifactResolver: IArtifactResolver;
  distTag: string;
  granularity: Granularity;
  rootStackTagValue: string;
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
      environment: ArtifactUpdaterLambda.environmentOf(props),
    });

    // No grant on UI buckets: S3 object writes cannot be scoped by tag, so a bucket's own ARN is the only scope.
    this.grantTagDiscovery();
    this.grantLambdaManagementAccess(props.rootStackTagValue);
    this.grantLambdaTagAccess(props.rootStackTagValue);
    this.grantEdgeLambdaAccess(props.rootStackTagValue);
    this.grantCloudFrontManagementAccess(props.rootStackTagValue);
    this.grantCloudFrontTagAccess(props.rootStackTagValue);
    this.grantCloudFrontListAccess();
    this.grantArtifactReleaseAccess(props.artifactBucketBase);
    this.grantSelfInvoke();
  }

  private static environmentOf(props: ArtifactUpdaterLambdaProps): Record<ArtifactUpdaterEnvName, string> {
    return {
      [ArtifactUpdaterEnvNames.artifactBucketBase]: props.artifactBucketBase,
      [ArtifactUpdaterEnvNames.distTag]: props.distTag,
      [ArtifactUpdaterEnvNames.granularity]: props.granularity,
      [ArtifactUpdaterEnvNames.project]: ArtifactUpdaterLambda.project,
      [ArtifactUpdaterEnvNames.rootStackTagValue]: props.rootStackTagValue,
    };
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

  private grantLambdaManagementAccess(rootStackTagValue: string): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:UpdateFunctionCode', 'lambda:InvokeFunction'],
        resources: [ArtifactUpdaterLambda.anyFunctionArn],
        conditions: {
          StringEquals: rootStackResourceTagCondition(rootStackTagValue),
        },
      }),
    );
  }

  private grantLambdaTagAccess(rootStackTagValue: string): void {
    this.grantArtifactVersionTagging('lambda:TagResource', ArtifactUpdaterLambda.anyFunctionArn, rootStackTagValue);
  }

  /** Edge functions are always in us-east-1. */
  private grantEdgeLambdaAccess(rootStackTagValue: string): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:GetFunctionConfiguration', 'lambda:PublishVersion'],
        resources: [`arn:aws:lambda:us-east-1:${Aws.ACCOUNT_ID}:function:*`],
        conditions: {
          StringEquals: rootStackResourceTagCondition(rootStackTagValue),
        },
      }),
    );
  }

  /** The CloudFront distribution resource type supports `aws:ResourceTag`, so distributions are scoped by the root-stack tag. */
  private grantCloudFrontManagementAccess(rootStackTagValue: string): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudfront:GetDistributionConfig', 'cloudfront:UpdateDistribution', 'cloudfront:CreateInvalidation'],
        resources: [ArtifactUpdaterLambda.anyDistributionArn],
        conditions: {
          StringEquals: rootStackResourceTagCondition(rootStackTagValue),
        },
      }),
    );
  }

  private grantCloudFrontTagAccess(rootStackTagValue: string): void {
    this.grantArtifactVersionTagging('cloudfront:TagResource', ArtifactUpdaterLambda.anyDistributionArn, rootStackTagValue);
  }

  /** ListDistributions is read-only enumeration and cannot be scoped. */
  private grantCloudFrontListAccess(): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudfront:ListDistributions'],
        resources: ['*'],
      }),
    );
  }

  private grantArtifactReleaseAccess(artifactBucketBase: string): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${artifactBucketBase}-*/${ArtifactUpdaterLambda.project}/packages/*/releases/*`],
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
   * Tag writes are limited to the artifact-version key, so the role cannot rewrite the root-stack tag
   * that scopes its other grants or inject tags another policy trusts.
   */
  private grantArtifactVersionTagging(action: string, resourceArn: string, rootStackTagValue: string): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [action],
        resources: [resourceArn],
        conditions: {
          StringEquals: rootStackResourceTagCondition(rootStackTagValue),
          'ForAllValues:StringEquals': {
            'aws:TagKeys': [ServerlessInboxTagKeys.artifactVersion],
          },
        },
      }),
    );
  }
}
