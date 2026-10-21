import type { IArtifactResolver }  from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Duration, Stack }         from 'aws-cdk-lib';
import { Construct }               from 'constructs';

import {
  buildSupportTierEnvironment,
} from '../platform/support/support-roles-infra';
import type { IDataTable }        from '../resources/tables/data-tables';
import type { IAuditEventsQueue } from '../features/audit-writing/audit-events-queue';

export interface SupportApiLambdaProps {
  /** Support-hop role ARN — scoped for tag-based access control. */
  readonly supportHopRoleArn: string;
  /** Support tier role ARNs (constructId -> arn), keyed by tier constructId for env var generation. */
  readonly tierRoleArns: Record<string, string>;
  /** DynamoDB config table for support access grant records. */
  readonly configTable: IDataTable;
  /** SQS queue for audit events. */
  readonly auditEventsQueue: IAuditEventsQueue;
  /** Artifact resolver (engine) for Lambda code resolution. */
  readonly artifactResolver: IArtifactResolver;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
  /** IAM tag key for the support-diag tier, sourced from the support-roles tier registry. */
  readonly supportDiagTagKey: string;
  /** IAM tag key for the support-config-read tier, sourced from the support-roles tier registry. */
  readonly supportConfigReadTagKey: string;
  /** All support tier IAM tag keys, for the aws:TagKeys condition on tag-write grants. */
  readonly supportTierTagKeys: string[];
}

/**
 * Support API Lambda construct.
 *
 * Go lambda that handles:
 * - Case RPCs: OpenSupportCase, CloseSupportCase, ListSupportCases
 * - Tag-based access control: TagRole/UntagRole on support-hop for serverless-inbox:support:diag and serverless-inbox:support:config-read tags
 * - Session listing via live CloudTrail query: hybrid approach with the hourly collector
 *
 * Execution role permissions:
 * - iam:TagRole + iam:UntagRole: scoped to support-hop role only, constrained by aws:TagKeys to
 *   serverless-inbox:support:diag and serverless-inbox:support:config-read only. Cannot modify any other role or tag any other keys.
 *   This is the ONLY IAM action the lambda holds. Tag visibility on support-diag/support-config-read
 *   trust policies gates access. Tier policies and permissions boundary are immutable from the lambda.
 * - iam:PutRolePermissionsBoundary / iam:DeleteRolePermissionsBoundary / iam:AttachRolePolicy /
 *   iam:DetachRolePolicy / iam:PutRolePolicy / iam:DeleteRolePolicy / iam:UpdateAssumeRolePolicy /
 *   iam:GetRole: NEVER granted. These are blocked by design.
 * - Config table read/write for support grant records
 * - CloudTrail LookupEvents for querying recent assume-role events (live half of hybrid read)
 * - SQS send for audit events
 *
 * Scoped to exactly the support-hop role ARN for the tag-write actions.
 * Tier permissions on support roles are visible in the synthesized template; the lambda cannot modify them.
 */
export class SupportApiLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: SupportApiLambdaProps) {
    // Build environment object with fixed order for CloudFormation template stability:
    // SUPPORT_HOP_ROLE_ARN, CONFIG_TABLE_NAME, AUDIT_EVENTS_QUEUE_URL, STACK_ID, then tier vars (from registry order)
    const tierEnv                             = buildSupportTierEnvironment(props.tierRoleArns);
    const environment: Record<string, string> = {
      SUPPORT_HOP_ROLE_ARN: props.supportHopRoleArn,
      CONFIG_TABLE_NAME: props.configTable.tableName,
      AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
      STACK_ID: Stack.of(scope).stackId,
      SUPPORT_DIAG_TAG_KEY: props.supportDiagTagKey,
      SUPPORT_CONFIG_READ_TAG_KEY: props.supportConfigReadTagKey,
      ...tierEnv,
    };

    super(scope, id, {
      lambdaId: 'support-api',
      pipeline: 'admin',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment,
    });

    this.grantSupportHopRoleTagWrites(props);
    // Config table access for support grant records.
    props.configTable.grantReadWrite(this);
    // Grant send permission on the audit-events queue
    props.auditEventsQueue.grantSend(this);
    this.grantCloudTrailLookup();

    this.grantVendorApiInvoke(props);
  }

  private grantSupportHopRoleTagWrites(props: SupportApiLambdaProps): void {
    // Scoped precisely to the support-hop role — nothing else, no wildcards, no other resources.
    // Tag writes only: TagRole and UntagRole, constrained by aws:TagKeys to tier-specific tag keys.
    // Cannot modify any other role or tag any other keys.
    // IMPORTANT: aws:TagKeys is a multivalued condition key and requires the ForAllValues set operator.
    // Using plain StringEquals would cause silent denials (the condition never matches). ForAllValues ensures
    // that every tag key in the request is in the allowed set, preventing the lambda from writing keys outside
    // serverless-inbox:support:diag and serverless-inbox:support:config-read. Do not "simplify" this back to StringEquals — that change
    // would silently break all tag writes.
    this.addToRolePolicy(new PolicyStatement({
      actions: [
        'iam:TagRole',
        'iam:UntagRole',
      ],
      resources: [props.supportHopRoleArn],
      conditions: {
        'ForAllValues:StringEquals': {
          'aws:TagKeys': props.supportTierTagKeys,
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

  private grantVendorApiInvoke(props: SupportApiLambdaProps): void {
    // SigV4-signed cross-account call to the vendor service API.
    // Route (POST /support-case-sync) and vendor accounts are known at synth time; region and API ID are not (vendor-chosen).
    const resources = props.vendorAccountIds.map(accountId => `arn:aws:execute-api:*:${accountId}:*/*/POST/support-case-sync`);

    this.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['execute-api:Invoke'],
      resources,
    }));
  }
}
