import { EventSourceMapping }             from 'aws-cdk-lib/aws-lambda';
import type { IFunction }                 from 'aws-cdk-lib/aws-lambda';
import { Duration }                       from 'aws-cdk-lib';
import type { Construct }                 from 'constructs';

import type { IAuditEventsQueueConsumer } from '../queues/audit-events-queue';

export interface AuditEventsQueueEventProps {
  target: IFunction;
  queue:  IAuditEventsQueueConsumer;
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
