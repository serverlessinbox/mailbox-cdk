import type { IArtifactResolver }    from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                  from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                  from 'aws-cdk-lib';
import { Construct }                 from 'constructs';

import type { IAuditEventsQueue }    from '../queues/audit-events-queue';
import type { IDataTable }           from '../tables/data-tables';

/** The tables, queue and artifact resolver the user-api Lambda is wired to. The caller creates every resource here. */
export interface UserApiLambdaProps {
  readonly configTable:      IDataTable;
  readonly itemTable:        IDataTable;
  readonly auditEventsQueue: IAuditEventsQueue;
  readonly artifactResolver: IArtifactResolver;
}

/**
 * The user-api Lambda that serves the user preferences API. It grants itself read and write on the
 * item table, read on the config table and send on the audit-events queue.
 */
export class UserApiLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: UserApiLambdaProps) {
    super(scope, id, {
      lambdaId:         'user-api',
      pipeline:         'admin',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.seconds(30),
      environment:      {
        CONFIG_TABLE_NAME:      props.configTable.tableName,
        ITEM_TABLE_NAME:        props.itemTable.tableName,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
      },
    });

    props.configTable.grantRead(this);
    props.itemTable.grantReadWrite(this);
    props.auditEventsQueue.grantSend(this);
  }
}
