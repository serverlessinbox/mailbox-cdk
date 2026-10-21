import { EventSourceMapping }      from 'aws-cdk-lib/aws-lambda';
import type { IFunction }          from 'aws-cdk-lib/aws-lambda';
import { Duration }                from 'aws-cdk-lib';
import type { Construct }          from 'constructs';

import type { ISesEventQueue }     from '../queues/ses-event-queue';

export interface SesNotificationsQueueEventProps {
  target: IFunction;
  queue: ISesEventQueue;
}

/** Invokes the target with batches of up to 100 SES notifications, at most 5 concurrent batches, reporting partial batch failures. */
export class SesNotificationsQueueEvent extends EventSourceMapping {
  constructor(scope: Construct, id: string, props: SesNotificationsQueueEventProps) {
    super(scope, id, {
      target: props.target,
      eventSourceArn: props.queue.queueArn,
      batchSize: 100,
      maxConcurrency: 5,
      reportBatchItemFailures: true,
      maxBatchingWindow: Duration.seconds(30),
    });
  }
}
