import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';

export interface StackUpdateApiLambdaProps {
  readonly rootStackArn: string;
  readonly configTable: ITable;
  readonly artifactBucketBase: string;
  readonly artifactResolver: ICdkArtifactEngine;
  readonly templateVersionParamName: string;
  readonly pointerBucket: string;
  readonly pointerKey: string;
  readonly templateUrlTemplate: string;
  readonly auditEventsQueue: IQueue;
  readonly distTag?: string;
}

/**
 * StackUpdate Lambda for human-gated CloudFormation ChangeSet operations
 * against the root stack.
 *
 * Executes with a dedicated IAM role that grants CloudFormation ChangeSet operations
 * (CreateChangeSet, DescribeChangeSet, ExecuteChangeSet, DeleteChangeSet, ListChangeSets,
 * DescribeStacks, GetTemplate) and S3 read access to template artifacts.
 *
 * Does NOT have cloudformation:SetStackPolicy — that is exclusively for the
 * Stack Policy custom resource.
 */
export class StackUpdateApiLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: StackUpdateApiLambdaProps) {
    super(scope, id, {
      lambdaId: 'stack-update-api',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        ROOT_STACK_ARN: props.rootStackArn,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ARTIFACT_BUCKET_BASE: props.artifactBucketBase,
        TEMPLATE_VERSION_PARAM_NAME: props.templateVersionParamName,
        POINTER_BUCKET: props.pointerBucket,
        POINTER_KEY: props.pointerKey,
        TEMPLATE_URL_TEMPLATE: props.templateUrlTemplate,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
        DIST_TAG: props.distTag ?? 'stable',
      },
    });

    // Grant CloudFormation permissions for ChangeSet operations
    // Note: ExecuteChangeSet and DescribeChangeSet authorize against the stack resource ARN
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudformation:CreateChangeSet',
          'cloudformation:DescribeChangeSet',
          'cloudformation:ExecuteChangeSet',
          'cloudformation:DeleteChangeSet',
          'cloudformation:ListChangeSets',
          'cloudformation:DescribeStacks',
          'cloudformation:GetTemplate',
        ],
        resources: [props.rootStackArn],
      })
    );

    // Grant S3 read access for template artifacts
    // Schema: {bucketBase}-{region}/serverlessinbox/templates/*/releases/*
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [
          `arn:aws:s3:::${props.artifactBucketBase}-*/serverlessinbox/templates/*/releases/*`,
        ],
      })
    );

    // Grant config table read-only access for authentication
    props.configTable.grantReadData(this);

    // Grant send permission on the audit-events queue (shared HTTP registry audit path)
    props.auditEventsQueue.grantSendMessages(this);

    // Stack management permissions: Lambda now executes ChangeSet operations without a separate
    // execution role. CloudFormation runs under the Lambda's identity when no RoleARN is provided.
    this.addToRolePolicy(
      new PolicyStatement({
        sid: 'StackResourceServices',
        effect: Effect.ALLOW,
        actions: [
          'lambda:*',
          'dynamodb:*',
          's3:*',
          'sqs:*',
          'ses:*',
          'cognito-idp:*',
          'cloudfront:*',
          'apigateway:*',
          'logs:*',
          'events:*',
          'acm:*',
          'route53:*',
          'states:*',
          'resource-groups:*',
          'sns:*',
          'ssm:PutParameter',
          'ssm:DeleteParameter',
          'ssm:GetParameter',
          'ssm:GetParameters',
          'ssm:AddTagsToResource',
          'ssm:RemoveTagsFromResource',
          'ssm:ListTagsForResource',
        ],
        resources: ['*'],
      })
    );

    this.addToRolePolicy(
      new PolicyStatement({
        sid: 'IamForChildRolesAndPolicies',
        effect: Effect.ALLOW,
        actions: [
          'iam:CreateRole',
          'iam:DeleteRole',
          'iam:UpdateRole',
          'iam:UpdateAssumeRolePolicy',
          'iam:TagRole',
          'iam:UntagRole',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:CreatePolicy',
          'iam:DeletePolicy',
          'iam:CreatePolicyVersion',
          'iam:DeletePolicyVersion',
          'iam:SetDefaultPolicyVersion',
          'iam:TagPolicy',
          'iam:UntagPolicy',
          'iam:PassRole',
          'iam:CreateServiceLinkedRole',
          'iam:GetRole',
          'iam:GetRolePolicy',
          'iam:GetPolicy',
          'iam:GetPolicyVersion',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
        ],
        resources: ['*'],
      })
    );

    this.addToRolePolicy(
      new PolicyStatement({
        sid: 'SelfStackCfnMeta',
        effect: Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplate',
        ],
        resources: ['*'],
      })
    );
  }
}
