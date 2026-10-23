import type { IArtifactResolver }          from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                        from '@serverlessinbox/mailbox-cdk-shared';
import { PolicyStatement, Effect }         from 'aws-cdk-lib/aws-iam';
import { Aws, Duration, Stack }            from 'aws-cdk-lib';
import { Construct }                       from 'constructs';

import type { ISupportRoles }              from '../../contracts/support-roles';
import type { IAuditEventsQueue }          from '../queues/audit-events-queue';
import type { IDataTable }                 from '../tables/data-tables';

/** Inputs of the support API Lambda. */
export interface SupportApiLambdaProps {
  /** The support roles the Lambda opens and closes access to, and the grants it holds on them. */
  readonly supportRoles: ISupportRoles;
  /** DynamoDB config table for support access grant records. */
  readonly configTable: IDataTable;
  /** SQS queue for audit events. */
  readonly auditEventsQueue: IAuditEventsQueue;
  /** Artifact resolver (engine) for Lambda code resolution. */
  readonly artifactResolver: IArtifactResolver;
  /** AWS account IDs hosting the vendor service API, resolved by the caller. Scopes the execute-api:Invoke permission. */
  readonly vendorAccountIds: string[];
}

/**
 * The Go Lambda behind the support case RPCs: it opens and closes a case by tagging the support hop
 * role, and lists a case's role assumptions from CloudTrail.
 *
 * Of the support roles it can only tag and untag the hop role.
 */
export class SupportApiLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: SupportApiLambdaProps) {
    super(scope, id, {
      lambdaId:         'support-api',
      pipeline:         'admin',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.seconds(30),
      memorySize:       256,
      environment:      {
        SUPPORT_HOP_ROLE_ARN:         props.supportRoles.hopRoleArn,
        CONFIG_TABLE_NAME:            props.configTable.tableName,
        AUDIT_EVENTS_QUEUE_URL:       props.auditEventsQueue.queueUrl,
        STACK_ID:                     Stack.of(scope).stackId,
        SUPPORT_DIAG_TAG_KEY:         props.supportRoles.diagTagKey,
        SUPPORT_CONFIG_READ_TAG_KEY:  props.supportRoles.configReadTagKey,
        SUPPORT_DIAG_ROLE_ARN:        props.supportRoles.diagRoleArn,
        SUPPORT_CONFIG_READ_ROLE_ARN: props.supportRoles.configReadRoleArn,
      },
    });

    props.supportRoles.grantTagWrites(this);
    props.configTable.grantReadWrite(this);
    props.auditEventsQueue.grantSend(this);
    props.supportRoles.grantAssumptionLookup(this);

    this.grantVendorApiInvoke(props.vendorAccountIds);
  }

  private grantVendorApiInvoke(vendorAccountIds: string[]): void {
    // Route (POST /support-case-sync) and vendor accounts are known at synth time; region and API ID are not (vendor-chosen).
    const resources = vendorAccountIds.map((accountId) => `arn:${Aws.PARTITION}:execute-api:*:${accountId}:*/*/POST/support-case-sync`);

    this.addToRolePolicy(new PolicyStatement({
      effect:  Effect.ALLOW,
      actions: ['execute-api:Invoke'],
      resources,
    }));
  }
}
