import { Aws, IResolvable, Stack } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { DeployerWorkerLambda, ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';

export interface MailboxDataDeployerWorkerProps {
  readonly artifactResolver: ICdkArtifactEngine;
  readonly stack: Stack;
  readonly dataStackArn: string;
  readonly dataStackName: string;
  readonly templateObjectArn: string;
  readonly nameBase: string | IResolvable;
}

/**
 * Worker Lambda for the mailbox data sub-stack deployer. Owns the IAM permissions CloudFormation
 * needs (acting as this role, since no `RoleArn` is passed) to create/update/delete the data
 * stack's DynamoDB tables and S3 bucket. Does not itself decide when to deploy — it is invoked by
 * the shared `PollingCfnDeployerWorkflow` built by `DeployerInfra`.
 */
export class MailboxDataDeployerWorker extends DeployerWorkerLambda {
  constructor(scope: Construct, id: string, props: MailboxDataDeployerWorkerProps) {
    super(scope, id, {
      artifactResolver: props.artifactResolver,
      serviceName: 'stack-deployer-data-worker',
    });

    this.grantStackLifecycle(props.dataStackArn);
    this.grantTemplateValidation();
    this.grantTemplateRead(props.templateObjectArn);
    this.grantDynamoDbTableManagement(props.stack, props.nameBase);
    this.grantS3BucketManagement(props.stack, props.nameBase);
    this.grantKmsAccess(props.stack);
    this.grantTaggingApiAccess();
  }

  private grantStackLifecycle(dataStackArn: string): void {
    // CloudFormation management of the data stack
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'cloudformation:CreateStack',
          'cloudformation:UpdateStack',
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplateSummary',
          'cloudformation:GetStackPolicy',
          'cloudformation:SetStackPolicy',
        ],
        resources: [dataStackArn],
      })
    );
  }

  private grantTemplateValidation(): void {
    // ValidateTemplate acts on S3 URLs, not stack ARNs — must be on *
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudformation:ValidateTemplate'],
        resources: ['*'],
      })
    );
  }

  private grantTemplateRead(templateObjectArn: string): void {
    // Read the data stack template from the artifact bucket (regional bucket)
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: [templateObjectArn],
      })
    );
  }

  private grantDynamoDbTableManagement(stack: Stack, nameBase: string | IResolvable): void {
    // CloudFormation creates DynamoDB tables using the caller's role (no RoleArn passed)
    // nameBase is already the data stack name (e.g., 'stackname-data'), so resource names
    // are built as ${account}-${nameBase}-<resourceName>, with no additional '-data-' segment.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'dynamodb:CreateTable',
          'dynamodb:DeleteTable',
          'dynamodb:DescribeTable',
          'dynamodb:UpdateTable',
          'dynamodb:UpdateContinuousBackups',
          'dynamodb:DescribeContinuousBackups',
          'dynamodb:UpdateTimeToLive',
          'dynamodb:DescribeTimeToLive',
          'dynamodb:DescribeTableReplicaAutoScaling',
          'dynamodb:TagResource',
          'dynamodb:UntagResource',
          'dynamodb:ListTagsOfResource',
        ],
        resources: [`arn:aws:dynamodb:${stack.region}:${stack.account}:table/${Aws.ACCOUNT_ID}-${nameBase}-*`],
      })
    );
  }

  private grantS3BucketManagement(stack: Stack, nameBase: string | IResolvable): void {
    // CloudFormation creates the S3 bucket using the caller's role
    // nameBase is already the data stack name (e.g., 'stackname-data'), so resource names
    // are built as ${account}-${nameBase}-<resourceName>, with no additional '-data-' segment.
    this.addToRolePolicy(
      new PolicyStatement({
        actions: [
          's3:CreateBucket',
          's3:DeleteBucket',
          's3:PutBucketPolicy',
          's3:GetBucketPolicy',
          's3:DeleteBucketPolicy',
          's3:PutBucketVersioning',
          's3:GetBucketVersioning',
          's3:PutBucketTagging',
          's3:GetBucketTagging',
          's3:PutLifecycleConfiguration',
          's3:GetLifecycleConfiguration',
          's3:PutEncryptionConfiguration',
          's3:GetEncryptionConfiguration',
          's3:PutBucketPublicAccessBlock',
          's3:GetBucketPublicAccessBlock',
          's3:GetBucketLocation',
          's3:PutBucketOwnershipControls',
          's3:GetBucketOwnershipControls',
        ],
        resources: [`arn:aws:s3:::${stack.account}-${nameBase}-*`],
      })
    );
  }

  private grantKmsAccess(stack: Stack): void {
    // KMS permissions for SSE-KMS on DynamoDB and S3 (CloudFormation uses caller identity)
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['kms:DescribeKey', 'kms:CreateGrant'],
        effect: Effect.ALLOW,
        resources: [
          `arn:aws:kms:${stack.region}:${stack.account}:alias/aws/dynamodb`,
          `arn:aws:kms:${stack.region}:${stack.account}:alias/aws/s3`,
          `arn:aws:kms:${stack.region}:${stack.account}:key/*`,
        ],
        conditions: {
          Bool: { 'kms:GrantIsForAWSResource': 'true' },
        },
      })
    );
  }

  private grantTaggingApiAccess(): void {
    // Tagging APIs (CloudFormation uses these broadly).
    // GetResources is read-only enumeration and must remain unscopable (on *).
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['tag:GetResources'],
        resources: ['*'],
      })
    );
    // TagResources/UntagResources are constrained by aws:TagKeys to only the tag keys
    // applyServerlessInboxBaseTagsWithDeployerType and applyServerlessInboxComponentTag
    // actually apply: the product/correlation tags plus the component tag (mailbox-data-stack.ts).
    // Prevents escalation via rewriting the root-stack scoping tag or injecting arbitrary tags.
    const dataStackTagKeys = [
      ServerlessInboxTagKeys.product,
      ServerlessInboxTagKeys.rootStack,
      ServerlessInboxTagKeys.stack,
      ServerlessInboxTagKeys.component,
      ServerlessInboxTagKeys.version,
      ServerlessInboxTagKeys.deployerType,
    ];
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['tag:TagResources', 'tag:UntagResources'],
        resources: ['*'],
        conditions: {
          'ForAllValues:StringEquals': {
            'aws:TagKeys': dataStackTagKeys,
          },
        },
      })
    );
  }
}
