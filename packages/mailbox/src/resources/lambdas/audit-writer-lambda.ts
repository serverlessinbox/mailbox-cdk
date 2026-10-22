import type { IArtifactResolver }         from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                       from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                       from 'aws-cdk-lib';
import { Construct }                      from 'constructs';

import { AuditEventsQueueEvent }          from '../events/audit-events-queue-event';
import type { IAuditEventsQueueConsumer } from '../queues/audit-events-queue';
import type { IDataTable }                from '../tables/data-tables';

export interface AuditWriterLambdaProps {
  auditLogTable:    IDataTable;
  auditEventsQueue: IAuditEventsQueueConsumer;
  artifactResolver: IArtifactResolver;
}

/**
 * Consumes the audit-events queue via its own SQS event source mapping. Owns both the mapping and
 * the consume grant; no other construct wires this Lambda to a queue.
 */
export class AuditWriterLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: AuditWriterLambdaProps) {
    super(scope, id, {
      lambdaId:         'audit-writer',
      pipeline:         'audit',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.minutes(2),
      memorySize:       256,
      environment:      {
        AUDIT_LOG_TABLE_NAME: props.auditLogTable.tableName,
      },
    });

    // Grant permissions
    props.auditLogTable.grantReadWrite(this);

    props.auditEventsQueue.grantConsume(this);

    new AuditEventsQueueEvent(this, 'audit-events-queue', { target: this, queue: props.auditEventsQueue });
  }
}
