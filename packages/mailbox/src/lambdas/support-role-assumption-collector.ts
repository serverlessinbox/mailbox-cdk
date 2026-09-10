import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import {
  buildSupportTierEnvironment,
} from '../addons/support-roles-infra';

export interface SupportRoleAssumptionCollectorLambdaProps {
  /** Support-hop role ARN — scoped for expiry enforcement via tag recomputation. */
  readonly supportHopRoleArn: string;
  /** Support tier role ARNs (constructId -> arn), keyed by tier constructId for env var generation. */
  readonly tierRoleArns: Record<string, string>;
  /** DynamoDB config table for storing collected role assumptions and tracking. */
  readonly configTable: ITable;
  /** Artifact resolver (engine) for Lambda code resolution. */
  readonly artifactResolver: ICdkArtifactEngine;
  /** IAM tag key for the support-diag tier, sourced from the support-roles tier registry. */
  readonly supportDiagTagKey: string;
  /** IAM tag key for the support-config-read tier, sourced from the support-roles tier registry. */
  readonly supportConfigReadTagKey: string;
  /** All support tier IAM tag keys, for the aws:TagKeys condition on tag-write grants. */
  readonly supportTierTagKeys: string[];
}

/**
 * Support Role Assumption Collector Lambda construct.
 *
 * Go lambda that is invoked hourly by EventBridge to:
 * 1. Archive CloudTrail assume-role events into DynamoDB before the 90-day Event-history window closes.
 * 2. Enforce expiry by recomputing support-hop's tier tags, excluding expired cases and writing the updated tag values.
 *
 * Works in conjunction with the support-api lambda's live query path for a hybrid approach:
 * - Stored (archived) + Live (recent) = complete role assumption history per case
 * - Deduplicated by CloudTrail eventID (UUID) for idempotent re-collection
 * - Scheduled expiry: recompute and write tier tags, excluding expired cases, revokes access when expiresAt has passed
 *
 * Execution role permissions:
 * - cloudtrail:LookupEvents: query assume-role events in a narrow recent window
 * - iam:TagRole and iam:UntagRole: scoped to support-hop role only, constrained by aws:TagKeys to serverless-inbox:support:diag and serverless-inbox:support:config-read.
 *   TagRole is required for expiry enforcement (recompute-and-write model); UntagRole retained for removal path.
 * - iam:ListRoleTags: read-only access to compare current tag values so the recompute can skip a no-op write,
 *   avoiding a ~60s access-deny window that every TagRole write causes.
 * - Config table read/write: update lastCollectedAt timestamp and store role assumptions
 *
 * Schedule:
 * - Hourly trigger via EventBridge rule (permanently enabled, never disabled)
 * - Lambda queries the grant partition first and returns early when nothing to do
 * - Hourly granularity matches the role's maxSessionDuration (3600s) to bound expiry overrun
 *
 * Design notes:
 * - No lambda:InvokeFunction grant anywhere (D3 standing property)
 * - No events:EnableRule / events:DisableRule — rule stays on and lambda guards itself
 */
export class SupportRoleAssumptionCollectorLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: SupportRoleAssumptionCollectorLambdaProps) {
    // Build environment object with fixed order for CloudFormation template stability:
    // CONFIG_TABLE_NAME, SUPPORT_HOP_ROLE_ARN, then tier vars (from registry order)
    const tierEnv = buildSupportTierEnvironment(props.tierRoleArns);
    const environment: Record<string, string> = {
      CONFIG_TABLE_NAME: props.configTable.tableName,
      SUPPORT_HOP_ROLE_ARN: props.supportHopRoleArn,
      SUPPORT_DIAG_TAG_KEY: props.supportDiagTagKey,
      SUPPORT_CONFIG_READ_TAG_KEY: props.supportConfigReadTagKey,
      ...tierEnv,
    };

    super(scope, id, {
      lambdaId: 'support-role-assumption-collector',
      pipeline: 'admin',
      artifactResolver: props.artifactResolver,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment,
    });

    // Config table read/write for collected role assumptions and collection tracking (lastCollectedAt).
    props.configTable.grantReadWriteData(this);
    // Grant CloudTrail LookupEvents for querying assume-role events.
    this.grantCloudTrailLookup();
    // Grant UntagRole on support-hop for expiry enforcement.
    this.grantExpiryEnforcement(props.supportHopRoleArn, props.supportTierTagKeys);
  }

  private grantCloudTrailLookup(): void {
    // Grant read-only CloudTrail access for querying assume-role events.
    // CloudTrail actions declare no resource types, so resources: ['*'] is correct per IAM scoping.
    this.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'cloudtrail:LookupEvents',
      ],
      resources: ['*'],
    }));
  }

  private grantExpiryEnforcement(supportHopRoleArn: string, supportTierTagKeys: string[]): void {
    // Scoped precisely to the support-hop role — nothing else, no wildcards, no other resources.
    // TagRole and UntagRole: expiry is enforced by recomputing and writing the full tier-tag values
    // from DynamoDB, excluding expired cases. UntagRole retained for the removal path.
    // Cannot tag, modify any other role, or remove any other keys.
    // IMPORTANT: aws:TagKeys is a multivalued condition key and requires the ForAllValues set operator.
    // Using plain StringEquals would cause silent denials (the condition never matches). ForAllValues ensures
    // that every tag key in the request is in the allowed set, preventing the lambda from removing keys outside
    // serverless-inbox:support:diag and serverless-inbox:support:config-read. Do not "simplify" this back to StringEquals — that change
    // would silently break all tag removals.
    this.addToRolePolicy(new PolicyStatement({
      actions: [
        'iam:TagRole',
        'iam:UntagRole',
      ],
      resources: [supportHopRoleArn],
      conditions: {
        'ForAllValues:StringEquals': {
          'aws:TagKeys': supportTierTagKeys,
        },
      },
    }));

    // Read-only access to list current role tags on the support-hop role.
    // Scoped to the support-hop role only, no conditions — ListRoleTags carries no request
    // tag keys, so the TagKeys condition would be fragile and obscure intent.
    this.addToRolePolicy(new PolicyStatement({
      actions: [
        'iam:ListRoleTags',
      ],
      resources: [supportHopRoleArn],
    }));
  }
}
