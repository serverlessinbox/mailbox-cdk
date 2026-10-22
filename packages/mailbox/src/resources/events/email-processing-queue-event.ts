import { EventSourceMapping }                 from 'aws-cdk-lib/aws-lambda';
import type { IFunction }                     from 'aws-cdk-lib/aws-lambda';
import { Duration }                           from 'aws-cdk-lib';
import type { Construct }                     from 'constructs';

import type { IEmailProcessingQueueConsumer } from '../queues/email-processing-queue';

export interface EmailProcessingQueueEventProps {
  target: IFunction;
  queue:  IEmailProcessingQueueConsumer;
}

/** Invokes the target with batches of up to 10 inbound emails, reporting partial batch failures. */
export class EmailProcessingQueueEvent extends EventSourceMapping {
  constructor(scope: Construct, id: string, props: EmailProcessingQueueEventProps) {
    super(scope, id, {
      target:                  props.target,
      eventSourceArn:          props.queue.queueArn,
      batchSize:               10,
      reportBatchItemFailures: true,
      maxBatchingWindow:       Duration.seconds(15),
    });
  }
}
