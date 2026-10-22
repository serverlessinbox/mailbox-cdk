import { BaseQueue, type BaseQueueProps, SqsActions, grantQueueActions } from '@serverlessinbox/mailbox-cdk-shared';
import { IGrantable }                                                    from 'aws-cdk-lib/aws-iam';
import { IKey }                                                          from 'aws-cdk-lib/aws-kms';
import { QueueEncryption }                                               from 'aws-cdk-lib/aws-sqs';
import { Duration }                                                      from 'aws-cdk-lib';
import { Construct }                                                     from 'constructs';

/** Inputs of {@link EmailProcessingQueue}. */
export interface EmailProcessingQueueProps {
  /** Only `encryptionMasterKey` is read: with it the queues are KMS-encrypted, without it SQS-managed. */
  readonly queueProps?: Pick<BaseQueueProps, 'encryptionMasterKey'>;
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
 * must exceed the consumer's Lambda timeout plus its batching window; backed by a dead-letter queue
 * for messages that fail after 3 receives.
 *
 * `grantSend`/`grantConsume` expose only the specific SQS actions each kind of caller needs.
 *
 * Not responsible for wiring the consumer's event source mapping.
 */
export class EmailProcessingQueue extends Construct implements IEmailProcessingQueueConsumer {
  public readonly queue: BaseQueue;
  public readonly dlq: BaseQueue;
  public readonly queueUrl: string;
  public readonly queueArn: string;

  constructor(scope: Construct, id: string, props: EmailProcessingQueueProps = {}) {
    super(scope, id);

    const queueEncryptionProps = this.encryptionProps(props.queueProps?.encryptionMasterKey);

    this.dlq = new BaseQueue(this, 'email-processing-dlq', {
      ...queueEncryptionProps,
      retentionPeriod: Duration.days(14),
    });

    this.queue    = new BaseQueue(this, 'email-processing-queue', {
      ...queueEncryptionProps,
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue:   {
        queue:           this.dlq,
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

  private encryptionProps(masterKey: IKey | undefined): Partial<BaseQueueProps> {
    if (masterKey) {
      return { encryption: QueueEncryption.KMS, encryptionMasterKey: masterKey };
    }
    return { encryption: QueueEncryption.SQS_MANAGED };
  }
}
