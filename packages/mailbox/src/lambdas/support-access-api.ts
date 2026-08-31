import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { getSupportTierTagKeys, buildSupportTierEnvironment } from '../addons/support-access-roles-infra';

export interface SupportAccessApiLambdaProps {
  /** Support-hop role ARN — scoped for tag-based access control. */
  readonly supportHopRoleArn: string;
  /** Support tier role ARNs (constructId -> arn), keyed by tier constructId for env var generation. */
  readonly tierRoleArns: Record<string, string>;
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
 * - Tag-based access control: TagRole/UntagRole on support-hop for serverless-inbox:support-access:diag and serverless-inbox:support-access:config-read tags
 * - Session listing via live CloudTrail query: hybrid approach with the hourly collector
 *
 * Execution role permissions:
 * - iam:TagRole + iam:UntagRole: scoped to support-hop role only, constrained by aws:TagKeys to
 *   serverless-inbox:support-access:diag and serverless-inbox:support-access:config-read only. Cannot modify any other role or tag any other keys.
 *   This is the ONLY IAM action the lambda holds. Tag visibility on support-diag/support-config-read
 *   trust policies gates access. Tier policies and permissions boundary are immutable from the lambda.
 * - iam:PutRolePermissionsBoundary / iam:DeleteRolePermissionsBoundary / iam:AttachRolePolicy /
 *   iam:DetachRolePolicy / iam:PutRolePolicy / iam:DeleteRolePolicy / iam:UpdateAssumeRolePolicy /
 *   iam:GetRole: NEVER granted. These are blocked by design.
 * - Config table read/write for support access grant records
 * - CloudTrail LookupEvents for querying recent assume-role events (live half of hybrid read)
 * - SQS send for audit events
 *
 * Scoped to exactly the support-hop role ARN for the tag-write actions.
 * Tier permissions on support roles are visible in the synthesized template; the lambda cannot modify them.
 */
export class SupportAccessApiLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: SupportAccessApiLambdaProps) {
    // Build environment object with fixed order for CloudFormation template stability:
    // SUPPORT_HOP_ROLE_ARN, CONFIG_TABLE_NAME, AUDIT_EVENTS_QUEUE_URL, then tier vars (from registry order)
    const tierEnv = buildSupportTierEnvironment(props.tierRoleArns);
    const environment: Record<string, string> = {
      SUPPORT_HOP_ROLE_ARN: props.supportHopRoleArn,
      CONFIG_TABLE_NAME: props.configTable.tableName,
      AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
      ...tierEnv,
    };

    super(scope, id, {
      lambdaId: 'support-access-api',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment,
    });

    this.grantSupportHopRoleTagWrites(props);
    // Config table access for support access grant records.
    props.configTable.grantReadWriteData(this);
    // Grant send permission on the audit-events queue
    props.auditEventsQueue.grantSendMessages(this);
    this.grantCloudTrailLookup();
  }

  private grantSupportHopRoleTagWrites(props: SupportAccessApiLambdaProps): void {
    // Scoped precisely to the support-hop role — nothing else, no wildcards, no other resources.
    // Tag writes only: TagRole and UntagRole, constrained by aws:TagKeys to tier-specific tag keys.
    // Cannot modify any other role or tag any other keys.
    // IMPORTANT: aws:TagKeys is a multivalued condition key and requires the ForAllValues set operator.
    // Using plain StringEquals would cause silent denials (the condition never matches). ForAllValues ensures
    // that every tag key in the request is in the allowed set, preventing the lambda from writing keys outside
    // serverless-inbox:support-access:diag and serverless-inbox:support-access:config-read. Do not "simplify" this back to StringEquals — that change
    // would silently break all tag writes.
    this.addToRolePolicy(new PolicyStatement({
      actions: [
        'iam:TagRole',
        'iam:UntagRole',
      ],
      resources: [props.supportHopRoleArn],
      conditions: {
        'ForAllValues:StringEquals': {
          'aws:TagKeys': getSupportTierTagKeys(),
        },
      },
    }));
  }

  private grantCloudTrailLookup(): void {
    // Grant CloudTrail LookupEvents for querying assume-role events in the live read path.
    // CloudTrail actions declare no resource types, so resources: ['*'] is correct per IAM scoping.
    this.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'cloudtrail:LookupEvents',
      ],
      resources: ['*'],
    }));
  }
}
