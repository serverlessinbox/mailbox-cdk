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
 * Read or read-write access to the email-processing queue without exposing the underlying SQS
 * queue. A holder can request a scoped grant (`grantSend`, `grantConsume`); it cannot reach the raw
 * CDK queue construct through this interface.
 */
export interface IEmailProcessingQueue {
  grantSend(grantee: IGrantable): void;

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
export class EmailProcessingQueue extends Construct implements IEmailProcessingQueue {
  public readonly queue: BaseQueue;
  public readonly dlq: BaseQueue;

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

    this.queue = new BaseQueue(this, 'email-processing-queue-v2', {
      ...queueEncryptionProps,
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 3,
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
