import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { getSupportTierTagKeys, buildSupportTierEnvironment } from '../addons/support-access-roles-infra';

export interface SupportRoleAssumptionCollectorLambdaProps {
  /** Support-hop role ARN — scoped for expiry enforcement via untagging. */
  readonly supportHopRoleArn: string;
  /** Support tier role ARNs (constructId -> arn), keyed by tier constructId for env var generation. */
  readonly tierRoleArns: Record<string, string>;
  /** DynamoDB config table for storing collected role assumptions and tracking. */
  readonly configTable: ITable;
  /** Artifact resolver (engine) for Lambda code resolution. */
  readonly artifactResolver: ICdkArtifactEngine;
}

/**
 * Support Role Assumption Collector Lambda construct.
 *
 * Go lambda that is invoked hourly by EventBridge to:
 * 1. Archive CloudTrail assume-role events into DynamoDB before the 90-day Event-history window closes.
 * 2. Enforce expiry by untagging support-hop for any case past its expiresAt timestamp.
 *
 * Works in conjunction with the support-access-api lambda's live query path for a hybrid approach:
 * - Stored (archived) + Live (recent) = complete role assumption history per case
 * - Deduplicated by CloudTrail eventID (UUID) for idempotent re-collection
 * - Scheduled expiry: untagging revokes access when expiresAt has passed
 *
 * Execution role permissions:
 * - cloudtrail:LookupEvents: query assume-role events in a narrow recent window
 * - iam:UntagRole: scoped to support-hop role only, constrained by aws:TagKeys to supportDiagCases and supportConfigCases
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
      ...tierEnv,
    };

    super(scope, id, {
      lambdaId: 'support-role-assumption-collector',
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
    this.grantExpiryEnforcement(props.supportHopRoleArn);
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

  private grantExpiryEnforcement(supportHopRoleArn: string): void {
    // Scoped precisely to the support-hop role — nothing else, no wildcards, no other resources.
    // Untag only: UntagRole, constrained by aws:TagKeys to tier-specific tag keys.
    // Cannot tag, modify any other role, or remove any other keys.
    this.addToRolePolicy(new PolicyStatement({
      actions: [
        'iam:UntagRole',
      ],
      resources: [supportHopRoleArn],
      conditions: {
        StringEquals: {
          'aws:TagKeys': getSupportTierTagKeys(),
        },
      },
    }));
  }
}
