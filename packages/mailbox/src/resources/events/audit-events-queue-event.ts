import { EventSourceMapping }             from 'aws-cdk-lib/aws-lambda';
import type { IFunction }                 from 'aws-cdk-lib/aws-lambda';
import { Duration }                       from 'aws-cdk-lib';
import type { Construct }                 from 'constructs';

import type { IAuditEventsQueueConsumer } from '../queues/audit-events-queue';

/** Settings of the mapping that feeds audit events from their queue to a function. */
export interface AuditEventsQueueEventProps {
  /** The function that receives each batch of audit events. */
  readonly target: IFunction;
  /** The queue the audit events are read from, seen from the consuming side. */
  readonly queue:  IAuditEventsQueueConsumer;
}

/** Invokes the target with batches of up to 100 audit events, reporting partial batch failures. */
export class AuditEventsQueueEvent extends EventSourceMapping {
  constructor(scope: Construct, id: string, props: AuditEventsQueueEventProps) {
    super(scope, id, {
      target:                  props.target,
      eventSourceArn:          props.queue.queueArn,
      batchSize:               100,
      maxBatchingWindow:       Duration.seconds(30),
      reportBatchItemFailures: true,
    });
  }
}
