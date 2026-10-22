import { BaseQueue, type BaseQueueProps, SqsActions, grantQueueActions } from '@serverlessinbox/mailbox-cdk-shared';
import type { IGrantable }                                               from 'aws-cdk-lib/aws-iam';
import { Duration }                                                      from 'aws-cdk-lib';
import { Construct }                                                     from 'constructs';

/** Props of {@link EmailSendingQueue}. */
export interface EmailSendingQueueProps {
  /** Optional default props applied to the queue and its DLQ (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Send-only access to the email-submissions queue, without exposing the underlying SQS queue
 * construct. A holder can enqueue a submission and build its own `EMAIL_SUBMISSION_QUEUE_URL`
 * environment variable from `queueUrl`; it cannot consume from the queue.
 */
export interface IEmailSendingQueue {
  /** The queue's URL, for a sender's `EMAIL_SUBMISSION_QUEUE_URL` environment variable. */
  readonly queueUrl: string;

  /** The queue's ARN, needed to wire a consumer's own SQS event source mapping. */
  readonly queueArn: string;

  grantSend(grantee: IGrantable): void;
}

/** {@link IEmailSendingQueue} extended with consume access, for the queue's single consumer. */
export interface IEmailSendingQueueConsumer extends IEmailSendingQueue {
  grantConsume(grantee: IGrantable): void;
}

/**
 * SQS queue carrying email submissions to the consumer that sends them via SES, backed by a
 * dead-letter queue for submissions that exceed the maximum receive count.
 *
 * The visibility timeout must exceed the consumer's function timeout plus its event source batching
 * window, otherwise a message still being processed becomes visible and is delivered again.
 *
 * `grantSend`/`grantConsume` expose only the specific SQS actions each kind of caller needs.
 *
 * Not responsible for wiring the consumer's event source mapping.
 */
export class EmailSendingQueue extends Construct implements IEmailSendingQueueConsumer {
  public readonly queueUrl: string;
  public readonly queueArn: string;
  private readonly queue: BaseQueue;

  constructor(scope: Construct, id: string, props: EmailSendingQueueProps = {}) {
    super(scope, id);

    const queueProps = props.queueProps ?? {};

    const dlq = new BaseQueue(this, 'email-submissions-dlq', {
      ...queueProps,
      retentionPeriod: Duration.days(14),
    });

    this.queue    = new BaseQueue(this, 'email-submissions', {
      ...queueProps,
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue:   {
        queue:           dlq,
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
