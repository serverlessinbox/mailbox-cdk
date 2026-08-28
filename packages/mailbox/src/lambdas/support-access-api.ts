import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';

export interface SupportAccessApiLambdaProps {
  /** Support-diag role ARN — scoped for trust/permissions policy writes. */
  readonly supportDiagRoleArn: string;
  /** Support-config-read role ARN — scoped for trust/permissions policy writes. */
  readonly supportConfigReadRoleArn: string;
  /** DynamoDB config table for support access grant records. */
  readonly configTable: ITable;
  /** SQS queue for audit events. */
  readonly auditEventsQueue: IQueue;
  /** Artifact resolver (engine) for Lambda code resolution. */
  readonly artifactResolver: ICdkArtifactEngine;
}

/**
 * Support Access API Lambda construct.
 *
 * Go lambda that handles:
 * - Case RPCs: OpenSupportAccessCase, CloseSupportAccessCase, ListSupportAccessCases
 * - IAM trust/permissions write: UpdateAssumeRolePolicy, PutRolePolicy, DeleteRolePolicy
 * - CloudTrail health check: DescribeTrails, GetTrailStatus (read-only)
 *
 * Execution role permissions:
 * - iam:UpdateAssumeRolePolicy: write trust policy to both support roles
 * - iam:PutRolePolicy: write permissions policy to both support roles
 * - iam:DeleteRolePolicy: strip permissions policy from both support roles (on close)
 * - Config table read/write for support access grant records
 * - Read-only CloudTrail actions for health check (DescribeTrails, GetTrailStatus)
 * - SQS send for audit events
 *
 * Scoped to exactly the two support role ARNs for the IAM actions.
 */
export class SupportAccessApiLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: SupportAccessApiLambdaProps) {
    super(scope, id, {
      lambdaId: 'support-access-api',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        SUPPORT_DIAG_ROLE_ARN: props.supportDiagRoleArn,
        SUPPORT_CONFIG_READ_ROLE_ARN: props.supportConfigReadRoleArn,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
        // Fixed inline policy names: written per-case via PutRolePolicy
        SUPPORT_DIAG_POLICY_NAME: 'support-diag-access',
        SUPPORT_CONFIG_READ_POLICY_NAME: 'support-config-read-access',
      },
    });

    this.grantSupportRolePolicyWrites(props);
    // Config table access for support access grant records.
    props.configTable.grantReadWriteData(this);
    // Grant send permission on the audit-events queue
    props.auditEventsQueue.grantSendMessages(this);
    this.grantCloudTrailHealthRead();
  }

  private grantSupportRolePolicyWrites(props: SupportAccessApiLambdaProps): void {
    // Scoped precisely to the two support roles — nothing else, no wildcards, no other resources.
    const roleArns = [props.supportDiagRoleArn, props.supportConfigReadRoleArn].filter(arn => arn);

    if (roleArns.length > 0) {
      this.addToRolePolicy(new PolicyStatement({
        actions: [
          'iam:GetRole',
          'iam:UpdateAssumeRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
        ],
        resources: roleArns,
      }));
    }
  }

  private grantCloudTrailHealthRead(): void {
    // Grant read-only CloudTrail access for health check (D13)
    // Trail ARNs are not knowable at synth time, so use resources: ["*"]
    this.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'cloudtrail:DescribeTrails',
        'cloudtrail:GetTrailStatus',
      ],
      resources: ['*'],
    }));
  }
}
