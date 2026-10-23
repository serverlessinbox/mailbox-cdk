import type { IArtifactResolver }        from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                      from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                      from 'aws-cdk-lib';
import { Construct }                     from 'constructs';

import type { ISupportRoles }            from '../../contracts/support-roles';
import { SupportCollectionSchedule }     from '../events/support-collection-schedule';
import type { IDataTable }               from '../tables/data-tables';

/**
 * The support roles whose assumptions it archives and whose tier tags it recomputes, the config table it
 * writes to and the artifact resolver for its code. The caller creates all of them.
 */
export interface SupportRoleAssumptionCollectorLambdaProps {
  /** The support roles whose assumptions are collected and whose hop role tags it recomputes, and the grants it holds on them. */
  readonly supportRoles: ISupportRoles;
  /** DynamoDB config table for storing collected role assumptions and tracking. */
  readonly configTable: IDataTable;
  /** Artifact resolver (engine) for Lambda code resolution. */
  readonly artifactResolver: IArtifactResolver;
}

/**
 * The Go Lambda that an hourly EventBridge rule invokes to archive CloudTrail assume-role events
 * into DynamoDB, and to enforce case expiry by recomputing the hop role's tier tags without the
 * expired cases.
 */
export class SupportRoleAssumptionCollectorLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: SupportRoleAssumptionCollectorLambdaProps) {
    super(scope, id, {
      lambdaId:         'support-role-assumption-collector',
      pipeline:         'admin',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.seconds(30),
      memorySize:       256,
      environment:      {
        CONFIG_TABLE_NAME:            props.configTable.tableName,
        SUPPORT_HOP_ROLE_ARN:         props.supportRoles.hopRoleArn,
        SUPPORT_DIAG_TAG_KEY:         props.supportRoles.diagTagKey,
        SUPPORT_CONFIG_READ_TAG_KEY:  props.supportRoles.configReadTagKey,
        SUPPORT_DIAG_ROLE_ARN:        props.supportRoles.diagRoleArn,
        SUPPORT_CONFIG_READ_ROLE_ARN: props.supportRoles.configReadRoleArn,
      },
    });

    props.configTable.grantReadWrite(this);
    props.supportRoles.grantAssumptionLookup(this);
    props.supportRoles.grantTagWrites(this);
    props.supportRoles.grantTagRead(this);

    new SupportCollectionSchedule(this, 'collection-schedule', { target: this });
  }
}
