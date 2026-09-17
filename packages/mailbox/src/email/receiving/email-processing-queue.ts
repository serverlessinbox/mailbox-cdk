import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IGrantable } from 'aws-cdk-lib/aws-iam';
import { QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { BaseQueue, type BaseQueueProps, SqsActions, grantQueueActions } from '@serverlessinbox/mailbox-cdk-shared';

export interface EmailProcessingQueueProps {
  /** Encryption props forwarded from the mailbox encryption plan. */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Send-only access to the email-processing queue, without exposing the underlying SQS queue
 * construct. `ses-receipt-forwarder` depends on this interface to enqueue an inbound-email
 * notification and to build its own `EMAIL_PROCESSOR_QUEUE_URL` environment variable — it never
 * needs to consume from this queue.
 */
export interface IEmailProcessingQueue {
  /** The queue's URL, for a sender's `EMAIL_PROCESSOR_QUEUE_URL` environment variable. */
  readonly queueUrl: string;

  /** The queue's ARN, needed to wire a consumer's own SQS event source mapping. */
  readonly queueArn: string;

  grantSend(grantee: IGrantable): void;
}

/**
 * Internal (non-exported) extension of {@link IEmailProcessingQueue} adding consume access.
 * Reserved for the single `email-processor` Lambda that drains this queue; every other holder only
 * ever sends to it and should depend on {@link IEmailProcessingQueue} instead.
 */
export interface IEmailProcessingQueueConsumer extends IEmailProcessingQueue {
  grantConsume(grantee: IGrantable): void;
}

/**
 * SQS queue carrying inbound-email notifications from `ses-receipt-forwarder` to the
 * `email-processor` consumer. Visibility timeout is set to exceed the consumer's Lambda timeout (1
 * minute); backed by a dead-letter queue for messages that fail after 3 receives.
 *
 * `grantSend`/`grantConsume` expose only the specific SQS actions each kind of caller needs.
 *
 * Not responsible for wiring the consumer's event source mapping — `SesRules` owns that.
 */
export class EmailProcessingQueue extends Construct implements IEmailProcessingQueueConsumer {
  public readonly queue: BaseQueue;
  public readonly dlq: BaseQueue;
  public readonly queueUrl: string;
  public readonly queueArn: string;

  constructor(scope: Construct, id: string, props: EmailProcessingQueueProps = {}) {
    super(scope, id);

    const queueEncryptionProps: Partial<BaseQueueProps> = (() => {
      const masterKey = props.queueProps?.encryptionMasterKey;
      if (masterKey) {
        return { encryption: QueueEncryption.KMS, encryptionMasterKey: masterKey };
      }
      return { encryption: QueueEncryption.SQS_MANAGED };
    })();

    this.dlq = new BaseQueue(this, 'email-processing-dlq-v2', {
      ...queueEncryptionProps,
      retentionPeriod: Duration.days(14),
    });

    this.queue = new BaseQueue(this, 'email-processing-queue-v3', {
      ...queueEncryptionProps,
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 3,
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
