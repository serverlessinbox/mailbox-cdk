import type { IArtifactResolver }                                                                          from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda, ServerlessInboxTagKeys, rootStackResourceTagConditions, GateOnConditionAspect } from '@serverlessinbox/mailbox-cdk-shared';
import type { RootStack }                                                                                  from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement }                                                                                 from 'aws-cdk-lib/aws-iam';
import { Aspects, Aws, Duration }                                                                          from 'aws-cdk-lib';
import type { CfnCondition }                                                                               from 'aws-cdk-lib';
import { Construct }                                                                                       from 'constructs';

import type { Granularity }                                                                                from '../../contracts/granularity';
import { MAILBOX_ARTIFACT_PACKAGE }                                                                        from '../../contracts/mailbox-artifact-package';
import { ArtifactUpdateSchedule }                                                                          from '../events/artifact-update-schedule';

/**
 * The release channel, granularity, root stack and schedule the artifact updater tracks. The caller
 * supplies the root stack and the artifact bucket; this type does not create either.
 */
export interface ArtifactUpdaterLambdaProps {
  readonly artifactResolver:   IArtifactResolver;
  readonly distTag:            string;
  readonly granularity:        Granularity;
  readonly rootStackTagValue:  string;
  readonly rootStackId:        string;
  readonly artifactBucketBase: string;
  readonly updateInterval:     Duration;
  /** The scheduled update exists only while this condition holds; the function itself always exists. */
  readonly isTracking: CfnCondition;
}

/**
 * The Lambda that moves a stack's tagged artifacts to newer releases. Its role holds every grant the
 * update needs, each scoped to the root stack by tag wherever the service honours the tag.
 */
export class ArtifactUpdaterLambda extends TypeScriptLambda {
  private static readonly anyFunctionArn = `arn:${Aws.PARTITION}:lambda:*:${Aws.ACCOUNT_ID}:function:*`;
  private static readonly anyDistributionArn = `arn:${Aws.PARTITION}:cloudfront::${Aws.ACCOUNT_ID}:distribution/*`;

  constructor(scope: Construct, id: string, props: ArtifactUpdaterLambdaProps) {
    super(scope, id, {
      lambdaId:         'artifact-updater',
      pipeline:         'infra',
      artifactResolver: props.artifactResolver,
      packageName:      MAILBOX_ARTIFACT_PACKAGE,
      timeout:          Duration.minutes(5),
      memorySize:       256,
      environment:      {
        ARTIFACT_BUCKET_BASE: props.artifactBucketBase,
        DIST_TAG:             props.distTag,
        GRANULARITY:          props.granularity,
        PROJECT:              props.artifactResolver.location.project,
        ROOT_STACK_TAG_VALUE: props.rootStackTagValue,
        ROOT_STACK_ID:        props.rootStackId,
      },
    });

    const rootStack: RootStack = { name: props.rootStackTagValue, id: props.rootStackId };
    // No grant on UI buckets: S3 object writes cannot be scoped by tag, so a bucket's own ARN is the only scope.
    this.grantTagDiscovery();
    this.grantLambdaManagementAccess(rootStack);
    this.grantLambdaTagAccess(rootStack);
    this.grantEdgeLambdaAccess(rootStack);
    this.grantCloudFrontManagementAccess(rootStack);
    this.grantCloudFrontTagAccess(rootStack);
    this.grantArtifactReleaseAccess(props.artifactBucketBase, props.artifactResolver.location.project);
    this.grantParentStackStatusRead();
    this.grantSelfInvoke();

    const schedule = new ArtifactUpdateSchedule(this, 'update-schedule', { target: this, interval: props.updateInterval });
    Aspects.of(schedule).add(new GateOnConditionAspect(props.isTracking));
  }

  /** GetResources is read-only enumeration and cannot be scoped. */
  private grantTagDiscovery(): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   ['tag:GetResources'],
        resources: ['*'],
      }),
    );
  }

  private grantLambdaManagementAccess(rootStack: RootStack): void {
    for (const conditions of rootStackResourceTagConditions(rootStack)) {
      this.addToRolePolicy(
        new PolicyStatement({
          actions:   ['lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:UpdateFunctionCode', 'lambda:InvokeFunction'],
          resources: [ArtifactUpdaterLambda.anyFunctionArn],
          conditions,
        }),
      );
    }
  }

  private grantLambdaTagAccess(rootStack: RootStack): void {
    this.grantArtifactVersionTagging('lambda:TagResource', ArtifactUpdaterLambda.anyFunctionArn, rootStack);
  }

  /** Edge functions are always in us-east-1. */
  private grantEdgeLambdaAccess(rootStack: RootStack): void {
    for (const conditions of rootStackResourceTagConditions(rootStack)) {
      this.addToRolePolicy(
        new PolicyStatement({
          actions:   ['lambda:GetFunctionConfiguration', 'lambda:PublishVersion'],
          resources: [`arn:${Aws.PARTITION}:lambda:us-east-1:${Aws.ACCOUNT_ID}:function:*`],
          conditions,
        }),
      );
    }
  }

  /** The CloudFront distribution resource type supports `aws:ResourceTag`, so distributions are scoped by the root-stack tags. */
  private grantCloudFrontManagementAccess(rootStack: RootStack): void {
    for (const conditions of rootStackResourceTagConditions(rootStack)) {
      this.addToRolePolicy(
        new PolicyStatement({
          actions:   ['cloudfront:GetDistributionConfig', 'cloudfront:UpdateDistribution', 'cloudfront:CreateInvalidation'],
          resources: [ArtifactUpdaterLambda.anyDistributionArn],
          conditions,
        }),
      );
    }
  }

  private grantCloudFrontTagAccess(rootStack: RootStack): void {
    this.grantArtifactVersionTagging('cloudfront:TagResource', ArtifactUpdaterLambda.anyDistributionArn, rootStack);
  }

  private grantArtifactReleaseAccess(artifactBucketBase: string, project: string): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   ['s3:GetObject'],
        resources: [`arn:${Aws.PARTITION}:s3:::${artifactBucketBase}-*/${project}/packages/*/releases/*`],
      }),
    );
  }

  /** Reads the status of the stack this function belongs to, to answer the deploy-end trigger correctly while that stack rolls back. */
  private grantParentStackStatusRead(): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions:   ['cloudformation:DescribeStacks'],
        resources: [Aws.STACK_ID],
      }),
    );
  }

  private grantSelfInvoke(): void {
    this.addPermission('self-invoke', {
      principal: this.grantPrincipal,
      action:    'lambda:InvokeFunction',
    });
  }

  /**
   * Tag writes are limited to the artifact-version key, so the role cannot rewrite the root-stack tags
   * that scope its other grants or inject tags another policy trusts.
   */
  private grantArtifactVersionTagging(action: string, resourceArn: string, rootStack: RootStack): void {
    for (const conditions of rootStackResourceTagConditions(rootStack)) {
      this.addToRolePolicy(
        new PolicyStatement({
          actions:    [action],
          resources:  [resourceArn],
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
