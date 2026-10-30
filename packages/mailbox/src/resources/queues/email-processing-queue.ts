import { BaseQueue, type QueueEncryptionChoice } from '@serverlessinbox/mailbox-cdk-shared';
import { IGrantable }                            from 'aws-cdk-lib/aws-iam';
import { Duration }                              from 'aws-cdk-lib';
import { Construct }                             from 'constructs';

/** Inputs of {@link EmailProcessingQueue}. */
export interface EmailProcessingQueueProps {
  /** The encryption of the queue and its DLQ. */
  readonly encryption: QueueEncryptionChoice;
}

/**
 * Send-only access to the email-processing queue, without exposing the underlying SQS queue
 * construct. A holder can enqueue an inbound-email notification and read the queue URL; it cannot
 * consume from the queue.
 */
export interface IEmailProcessingQueue {
  /** The queue's URL, for a sender's environment variable. */
  readonly queueUrl: string;

  /** The queue's ARN, needed to wire a consumer's own SQS event source mapping. */
  readonly queueArn: string;

  grantSend(grantee: IGrantable): void;
}

/**
 * Extension of {@link IEmailProcessingQueue} adding consume access, for the one holder that drains
 * the queue; every other holder should depend on {@link IEmailProcessingQueue}.
 */
export interface IEmailProcessingQueueConsumer extends IEmailProcessingQueue {
  grantConsume(grantee: IGrantable): void;
}

/**
 * SQS queue carrying inbound-email notifications to a consumer. Its visibility timeout (6 minutes)
 * must exceed the consumer's Lambda timeout plus its batching window; backed by a dead-letter queue,
 * created beside it, for messages that fail after 3 receives.
 *
 * Not responsible for wiring the consumer's event source mapping.
 */
export class EmailProcessingQueue extends BaseQueue implements IEmailProcessingQueueConsumer {
  constructor(scope: Construct, id: string, props: EmailProcessingQueueProps) {
    const dlq = new BaseQueue(scope, `${id}-dlq`, {
      encryption:      props.encryption,
      retentionPeriod: Duration.days(14),
    });

    super(scope, id, {
      encryption:        props.encryption,
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue:   {
        queue:           dlq,
        maxReceiveCount: 3,
      },
    });
  }
}
