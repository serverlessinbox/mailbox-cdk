import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IGrantable } from 'aws-cdk-lib/aws-iam';
import { BaseQueue, type BaseQueueProps, SqsActions, grantQueueActions } from '@serverlessinbox/mailbox-cdk-shared';

export interface EmailSendingQueueProps {
  /** Optional default props applied to the queue and its DLQ (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Send-only access to the email-submissions queue, without exposing the underlying SQS queue
 * construct. The admin/JMAP APIs and the identity provisioner depend on this interface to enqueue a
 * submission and to build their own `EMAIL_SUBMISSION_QUEUE_URL` environment variable — they never
 * need to consume from this queue.
 */
export interface IEmailSendingQueue {
  /** The queue's URL, for a sender's `EMAIL_SUBMISSION_QUEUE_URL` environment variable. */
  readonly queueUrl: string;

  /** The queue's ARN, needed to wire a consumer's own SQS event source mapping. */
  readonly queueArn: string;

  grantSend(grantee: IGrantable): void;
}

/**
 * Internal (non-exported) extension of {@link IEmailSendingQueue} adding consume access. Reserved
 * for the single `email-sender` Lambda that drains this queue; every other holder only ever sends
 * to it and should depend on {@link IEmailSendingQueue} instead.
 */
export interface IEmailSendingQueueConsumer extends IEmailSendingQueue {
  grantConsume(grantee: IGrantable): void;
}

/**
 * SQS queue carrying email submissions from the admin/JMAP APIs and identity provisioner to the
 * `email-sender` consumer, which sends them via SES. Backed by a dead-letter queue for submissions
 * that fail after 5 receives.
 *
 * `grantSend`/`grantConsume` expose only the specific SQS actions each kind of caller needs.
 *
 * Not responsible for wiring the consumer's event source mapping — `EmailSending` owns that.
 */
export class EmailSendingQueue extends Construct implements IEmailSendingQueueConsumer {
  public readonly queue: BaseQueue;
  public readonly dlq: BaseQueue;
  public readonly queueUrl: string;
  public readonly queueArn: string;

  constructor(scope: Construct, id: string, props: EmailSendingQueueProps = {}) {
    super(scope, id);

    const queueProps = props.queueProps ?? {};

    this.dlq = new BaseQueue(this, 'email-submissions-dlq', {
      ...queueProps,
      retentionPeriod: Duration.days(14),
    });

    this.queue = new BaseQueue(this, 'email-submissions', {
      ...queueProps,
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 5,
      },
    });
    this.queueUrl = this.queue.queueUrl;
    this.queueArn = this.queue.queueArn;
  }

  public grantSend(grantee: IGrantable): void {
    grantQueueActions(grantee, this.queue, SqsActions.send);
  }

  public grantConsume(grantee: IGrantable): void {
    grantQueueActions(grantee, this.queue, SqsActions.consume);
  }
}
