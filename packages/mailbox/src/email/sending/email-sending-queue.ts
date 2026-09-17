import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IGrantable } from 'aws-cdk-lib/aws-iam';
import { BaseQueue, type BaseQueueProps, SqsActions, grantQueueActions } from '@serverlessinbox/mailbox-cdk-shared';

export interface EmailSendingQueueProps {
  /** Optional default props applied to the queue and its DLQ (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Read or read-write access to the email-submissions queue without exposing the underlying SQS
 * queue. A holder can request a scoped grant (`grantSend`, `grantConsume`); it cannot reach the raw
 * CDK queue construct through this interface.
 */
export interface IEmailSendingQueue {
  grantSend(grantee: IGrantable): void;

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
export class EmailSendingQueue extends Construct implements IEmailSendingQueue {
  public readonly queue: BaseQueue;
  public readonly dlq: BaseQueue;

  constructor(scope: Construct, id: string, props: EmailSendingQueueProps = {}) {
    super(scope, id);

    const queueProps = props.queueProps ?? {};

    this.dlq = new BaseQueue(this, 'email-submissions-dlq-v2', {
      ...queueProps,
      retentionPeriod: Duration.days(14),
    });

    this.queue = new BaseQueue(this, 'email-submissions-v2', {
      ...queueProps,
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 5,
      },
    });
  }

  public grantSend(grantee: IGrantable): void {
    grantQueueActions(grantee, this.queue, SqsActions.send);
  }

  public grantConsume(grantee: IGrantable): void {
    grantQueueActions(grantee, this.queue, SqsActions.consume);
  }
}
