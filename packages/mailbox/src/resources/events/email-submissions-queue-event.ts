import { EventSourceMapping }              from 'aws-cdk-lib/aws-lambda';
import type { IFunction }                  from 'aws-cdk-lib/aws-lambda';
import { Duration }                        from 'aws-cdk-lib';
import type { Construct }                  from 'constructs';

import type { IEmailSendingQueueConsumer } from '../queues/email-sending-queue';

/** Settings of the mapping that feeds submitted emails from the sending queue to a function. */
export interface EmailSubmissionsQueueEventProps {
  /** The function that receives each submitted email. */
  readonly target: IFunction;
  /** The queue the submitted emails are read from, seen from the consuming side. */
  readonly queue:  IEmailSendingQueueConsumer;
}

/** Invokes the target with one submitted email per batch. */
export class EmailSubmissionsQueueEvent extends EventSourceMapping {
  constructor(scope: Construct, id: string, props: EmailSubmissionsQueueEventProps) {
    super(scope, id, {
      target:            props.target,
      eventSourceArn:    props.queue.queueArn,
      batchSize:         1,
      maxBatchingWindow: Duration.seconds(15),
    });
  }
}
