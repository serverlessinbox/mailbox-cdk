import { Duration } from 'aws-cdk-lib';
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
}

/**
 * StackUpdate Lambda for human-gated CloudFormation ChangeSet operations
 * against the root stack.
 *
 * Prepares CloudFormation ChangeSets (CreateChangeSet, DescribeChangeSet, DeleteChangeSet,
 * ListChangeSets, DescribeStacks, GetTemplate) and reads template artifacts from S3.
 *
 * Does NOT execute ChangeSets or manage stack rollback — those are performed manually in the
 * AWS console under the operator's own credentials. Does NOT have cloudformation:SetStackPolicy
 * — that is exclusively for the Stack Policy custom resource.
 */
export class StackUpdateApiLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: StackUpdateApiLambdaProps) {
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
      },
    });

    this.grantChangeSetOperations(props.rootStackArn);
    this.grantTemplateArtifactRead(props.artifactBucketBase);

    // Grant config table read-only access for authentication
    props.configTable.grantRead(this);

    // Grant send permission on the audit-events queue (shared HTTP registry audit path)
    props.auditEventsQueue.grantSend(this);

    this.grantSelfStackCfnMeta(props.rootStackArn);
  }

  private grantChangeSetOperations(rootStackArn: string) {
    // Grant CloudFormation permissions for ChangeSet preparation only (no execution)
    // Human executes ChangeSets in AWS console under their own credentials
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cloudformation:CreateChangeSet',
          'cloudformation:DescribeChangeSet',
          'cloudformation:DeleteChangeSet',
          'cloudformation:ListChangeSets',
          'cloudformation:DescribeStacks',
          'cloudformation:GetTemplate',
        ],
        resources: [rootStackArn],
      })
    );
  }

  private grantTemplateArtifactRead(artifactBucketBase: string) {
    // Grant S3 read access for template artifacts
    // Schema: {bucketBase}-{region}/serverlessinbox/templates/*/releases/*
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [
          `arn:aws:s3:::${artifactBucketBase}-*/serverlessinbox/templates/*/releases/*`,
        ],
      })
    );
  }


  private grantSelfStackCfnMeta(rootStackArn: string) {
    // Read-only access to root stack metadata: status updates, events, and template.
    // Scoped to the root stack ARN only (not account-wide read of all stacks).
    this.addToRolePolicy(
      new PolicyStatement({
        sid: 'SelfStackCfnMeta',
        effect: Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplate',
        ],
        resources: [rootStackArn],
      })
    );
  }

}
