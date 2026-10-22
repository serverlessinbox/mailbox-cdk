import type { IArtifactResolver }                    from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription, type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import { Construct }                                 from 'constructs';

import { AuditWriterLambda }                         from '../../resources/lambdas/audit-writer-lambda';
import { AuditEventsQueue, type IAuditEventsQueue }  from '../../resources/queues/audit-events-queue';
import type { IDataTable }                           from '../../resources/tables/data-tables';

/** Props of {@link AuditWriting}: the table the audit events end up in and the code of the writer. */
export interface AuditWritingProps {
  readonly auditLogTable:    IDataTable;
  readonly artifactResolver: IArtifactResolver;

  /** Optional default props applied to all queues created by this construct (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * The audit pipeline: a queue that buffers audit events and the Lambda that writes them to the audit
 * log table. It hands out the queue as a send-only handle.
 */
export class AuditWriting extends Construct {
  /** Send-only handle to the audit-events queue; grant methods only, no raw SQS object. */
  public readonly auditEventsQueue: IAuditEventsQueue;

  constructor(scope: Construct, id: string, props: AuditWritingProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Audit logging pipeline — buffers audit events via SQS and writes them to the audit DynamoDB table.');

    const auditEventsQueue = new AuditEventsQueue(this, 'audit-events-queue', {
      queueProps: props.queueProps,
    });
    this.auditEventsQueue  = auditEventsQueue;

    new AuditWriterLambda(this, 'audit-writer', {
      auditLogTable:    props.auditLogTable,
      auditEventsQueue,
      artifactResolver: props.artifactResolver,
    });
  }
}
