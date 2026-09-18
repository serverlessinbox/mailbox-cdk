import { TypeScriptLambda, ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { Aws, Duration } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface ArtifactUpdaterLambdaProps {
  artifactResolver: ICdkArtifactEngine;

  /** Dist-tag to follow ('stable', 'beta', etc.). */
  distTag: string;

  /** Literal Granularity OR a CFN-parameter token; used for the updater's env and IsTracking. Typed `string`. */
  granularity: string;

  /** Root stack name (Aws.STACK_NAME). */
  rootStackTagValue: string;

  /** Base name for artifact S3 buckets (e.g., 'mailbox-artifacts'). */
  artifactBucketBase: string;

  /** DynamoDB lock table for update concurrency control. */
  readonly lockTable: ITable;
}

/**
 * Artifact updater Lambda wrapper.
 * Handles artifact updates via three trigger paths (deploy-end CR, EventBridge schedule, admin API invoke).
 * Runs tag-scan discovery and swaps deployed artifacts out-of-band, bounded by granularity.
 */
export class ArtifactUpdaterLambda extends TypeScriptLambda {
  private static readonly project = 'serverlessinbox';

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
        PROJECT: 'serverlessinbox',
        ROOT_STACK_TAG_VALUE: props.rootStackTagValue,
        LOCK_TABLE_NAME: props.lockTable.tableName,
      },
    });

    // Grant permissions to read/write the lock table
    props.lockTable.grantReadWriteData(this);

    // Updater IAM: comprehensive least-privilege (all always-on, apply to updater Lambda for all three trigger paths)
    this.grantTagDiscovery();
    this.grantLambdaManagementAccess(props.rootStackTagValue);
    this.grantLambdaTagAccess(props.rootStackTagValue);
    // UI auto-update: bucket-side grant. Each UI construct (MailboxUi.grantContentDeploy) grants
    // this updater's own principal write access to its own bucket, so this class never guesses a
    // UI bucket's name from a synth-time pattern — see MailboxUi.grantContentDeploy for the S3
    // action set and the tag-scoping finding that rules out a tag-based alternative.
    this.grantEdgeLambdaAccess(props.rootStackTagValue);
    this.grantCloudFrontManagementAccess(props.rootStackTagValue);
    this.grantCloudFrontTagAccess(props.rootStackTagValue);
    this.grantCloudFrontListAccess();
    this.grantArtifactReleaseAccess(props.artifactBucketBase);
    this.grantSelfInvoke();
  }

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
        resources: [`arn:aws:lambda:*:${Aws.ACCOUNT_ID}:function:*`],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: rootStackTagValue,
          },
        },
      }),
    );
  }

  private grantLambdaTagAccess(rootStackTagValue: string): void {
    // TagResource constrained to artifact-version tag only; prevents rewriting root-stack scope or injecting arbitrary tags
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:TagResource'],
        resources: [`arn:aws:lambda:*:${Aws.ACCOUNT_ID}:function:*`],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: rootStackTagValue,
          },
          'ForAllValues:StringEquals': {
            'aws:TagKeys': [ServerlessInboxTagKeys.artifactVersion],
          },
        },
      }),
    );
  }

  private grantEdgeLambdaAccess(rootStackTagValue: string): void {
    // Edge auto-update: publish new versions + update CloudFront
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:GetFunctionConfiguration', 'lambda:PublishVersion'],
        resources: [`arn:aws:lambda:us-east-1:${Aws.ACCOUNT_ID}:function:*`],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: rootStackTagValue,
          },
        },
      }),
    );
  }

  private grantCloudFrontManagementAccess(rootStackTagValue: string): void {
    // CloudFront distribution management: scope to this account and root-stack tag.
    // CloudFront distribution resource type supports aws:ResourceTag, so distributions are scoped by the root-stack tag.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudfront:GetDistributionConfig', 'cloudfront:UpdateDistribution', 'cloudfront:CreateInvalidation'],
        resources: [`arn:aws:cloudfront::${Aws.ACCOUNT_ID}:distribution/*`],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: rootStackTagValue,
          },
        },
      }),
    );
  }

  private grantCloudFrontTagAccess(rootStackTagValue: string): void {
    // TagResource constrained to distributions matching root-stack tag and allowing only artifact-version mutations.
    // Prevents rewriting root-stack scope or injecting arbitrary tags.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudfront:TagResource'],
        resources: [`arn:aws:cloudfront::${Aws.ACCOUNT_ID}:distribution/*`],
        conditions: {
          StringEquals: {
            [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: rootStackTagValue,
          },
          'ForAllValues:StringEquals': {
            'aws:TagKeys': [ServerlessInboxTagKeys.artifactVersion],
          },
        },
      }),
    );
  }

  private grantCloudFrontListAccess(): void {
    // CloudFront distribution listing: read-only enumeration, unscopable by AWS
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
}
