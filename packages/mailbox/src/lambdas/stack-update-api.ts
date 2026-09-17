import { Aws, ArnFormat, Duration, Stack } from 'aws-cdk-lib';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { IDataTable } from '../data/data-tables';
import { Construct } from 'constructs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IAuditEventsQueue } from '../features/audit-writing/audit-events-queue';

export interface StackUpdateApiLambdaProps {
  readonly rootStackArn: string;
  readonly configTable: IDataTable;
  readonly artifactBucketBase: string;
  readonly artifactResolver: ICdkArtifactEngine;
  readonly templateVersionParamName: string;
  readonly pointerBucket: string;
  readonly pointerKey: string;
  readonly templateUrlTemplate: string;
  readonly auditEventsQueue: IAuditEventsQueue;
  /**
   * Explicit name of the stack-update recovery state machine (`StackUpdateRecoveryInfra`).
   *
   * Passed as a name, not a reference: this Lambda and the state machine need each other's ARN
   * (this Lambda's `STACK_UPDATE_STATE_MACHINE_ARN` env var; the state machine's role needs
   * `lambda:InvokeFunction` on this Lambda), and threading a real CDK object reference both ways
   * would create a CloudFormation circular dependency. Instead both sides are given the SAME
   * deterministic name by their common composition root (`StackUpdateAddon`) and independently
   * derive the state machine's ARN from `Aws.*` tokens + this name — no `Ref`/`GetAtt` from this
   * Lambda's resource to the state machine's resource, so there is no cycle.
   */
  readonly stateMachineName: string;
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
    // Built from Aws.* tokens + the shared deterministic name, never from the state machine
    // construct itself — see the `stateMachineName` prop doc for why.
    const stateMachineArn = Stack.of(scope).formatArn({
      service: 'states',
      resource: 'stateMachine',
      resourceName: props.stateMachineName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      account: Aws.ACCOUNT_ID,
      region: Aws.REGION,
      partition: Aws.PARTITION,
    });
    const executionArnPattern = Stack.of(scope).formatArn({
      service: 'states',
      resource: 'execution',
      resourceName: `${props.stateMachineName}:*`,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
      account: Aws.ACCOUNT_ID,
      region: Aws.REGION,
      partition: Aws.PARTITION,
    });

    super(scope, id, {
      lambdaId: 'stack-update-api',
      pipeline: 'infra',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        ROOT_STACK_ARN: props.rootStackArn,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        TEMPLATE_VERSION_PARAM_NAME: props.templateVersionParamName,
        POINTER_BUCKET: props.pointerBucket,
        POINTER_KEY: props.pointerKey,
        TEMPLATE_URL_TEMPLATE: props.templateUrlTemplate,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
        STACK_UPDATE_STATE_MACHINE_ARN: stateMachineArn,
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
    props.configTable.grantRead(this);

    // Grant send permission on the audit-events queue (shared HTTP registry audit path)
    props.auditEventsQueue.grantSend(this);

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
          'iam:PutRolePermissionsBoundary',
          'iam:DeleteRolePermissionsBoundary',
          'iam:UpdateRoleDescription',
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
          'iam:ListPolicyVersions',
          'iam:ListEntitiesForPolicy',
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

    // Rollback-recovery reads/writes on the root stack, scoped to its ARN. DescribeStackEvents and
    // iam:GetPolicy/iam:GetPolicyVersion are already granted above (SelfStackCfnMeta,
    // IamForChildRolesAndPolicies respectively) — not repeated here.
    this.addToRolePolicy(
      new PolicyStatement({
        sid: 'RootStackRollbackRecovery',
        effect: Effect.ALLOW,
        actions: [
          'cloudformation:ContinueUpdateRollback',
          'cloudformation:DescribeStackResource',
          'cloudformation:DescribeStackResources',
        ],
        resources: [props.rootStackArn],
      })
    );

    // Drive the recovery workflow: start a new episode, and check on this Lambda's own prior
    // executions (dedup in `event-start`, cap-checking in R5). Never a broader `states:*` grant.
    this.addToRolePolicy(
      new PolicyStatement({
        sid: 'StackUpdateWorkflowControl',
        effect: Effect.ALLOW,
        actions: ['states:StartExecution', 'states:ListExecutions'],
        resources: [stateMachineArn],
      })
    );
    this.addToRolePolicy(
      new PolicyStatement({
        sid: 'StackUpdateWorkflowExecutionStatus',
        effect: Effect.ALLOW,
        actions: ['states:DescribeExecution'],
        resources: [executionArnPattern],
      })
    );
  }
}
