import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IGrantable } from 'aws-cdk-lib/aws-iam';
import { BaseQueue, type BaseQueueProps, SqsActions, grantQueueActions } from '@serverlessinbox/mailbox-cdk-shared';

export interface AuditEventsQueueProps {
  /** Optional default props applied to the queue and its DLQ (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Send-only access to the audit-events queue, without exposing the underlying SQS queue
 * construct. Any Lambda that emits an audit event (admin-api, jmap-api, the identity provisioner,
 * the support and stack-update addons, and more) depends on this interface to enqueue a message
 * and to build its own `AUDIT_EVENTS_QUEUE_URL` environment variable — it never needs to consume
 * from this queue.
 *
 * Pass the `AuditEventsQueue` instance `AuditWriting` creates; there is no other implementation.
 */
export interface IAuditEventsQueue {
  /**
   * The queue's URL, in the exact form the AWS SDK's `SendMessage` call expects. Set this as the
   * env var your Lambda reads to enqueue audit events — never construct the URL by hand.
   */
  readonly queueUrl: string;

  /** The queue's ARN, needed to wire a consumer's own SQS event source mapping. */
  readonly queueArn: string;

  /**
   * Grants the given principal permission to send messages to this queue (`sqs:SendMessage` only).
   * Call this from inside your own Lambda's constructor once you hold this interface — never grant
   * on a queue you were merely handed a reference to from outside the grantee's own construct.
   */
  grantSend(grantee: IGrantable): void;
}

/**
 * Internal (non-exported) extension of {@link IAuditEventsQueue} adding consume access. Reserved
 * for the single `audit-writer` Lambda that drains this queue; every other holder only ever sends
 * to it and should depend on {@link IAuditEventsQueue} instead.
 */
export interface IAuditEventsQueueConsumer extends IAuditEventsQueue {
  grantConsume(grantee: IGrantable): void;
}

/**
 * SQS queue carrying audit events (account/tenant activity) from every Lambda that writes an audit
 * record to the single `audit-writer` consumer, backed by a dead-letter queue for messages that
 * fail processing after 5 receives.
 *
 * `grantSend`/`grantConsume` expose only the specific SQS actions each kind of caller needs.
 *
 * Not responsible for wiring the consumer's event source mapping — `AuditWriting` owns that.
 */
export class AuditEventsQueue extends Construct implements IAuditEventsQueueConsumer {
  public readonly queue: BaseQueue;
  public readonly dlq: BaseQueue;
  public readonly queueUrl: string;
  public readonly queueArn: string;

  constructor(scope: Construct, id: string, props: AuditEventsQueueProps = {}) {
    super(scope, id);

    const queueProps = props.queueProps ?? {};

    this.dlq = new BaseQueue(this, 'audit-events-dlq-v2', {
      ...queueProps,
      retentionPeriod: Duration.days(14),
    });

    this.queue = new BaseQueue(this, 'audit-events-v3', {
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
