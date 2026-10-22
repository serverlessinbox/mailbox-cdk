import { BaseQueue, type BaseQueueProps }                                    from '@serverlessinbox/mailbox-cdk-shared';
import type { IGrantable }                                                   from 'aws-cdk-lib/aws-iam';
import { Duration }                                                          from 'aws-cdk-lib';
import { Construct }                                                         from 'constructs';

/** Props of {@link AuditEventsQueue}. */
export interface AuditEventsQueueProps {
  /** Optional default props applied to the queue and its DLQ (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Send-only access to the audit-events queue, without exposing the underlying SQS queue
 * construct. A Lambda that emits an audit event depends on this interface to enqueue a message and
 * to build its own `AUDIT_EVENTS_QUEUE_URL` environment variable; it cannot consume from the queue.
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

/** {@link IAuditEventsQueue} extended with consume access, for the queue's single consumer. */
export interface IAuditEventsQueueConsumer extends IAuditEventsQueue {
  grantConsume(grantee: IGrantable): void;
}

/**
 * SQS queue carrying audit events (account/tenant activity) to the single consumer that writes
 * them, backed by a dead-letter queue, created beside it, for messages that exceed the maximum
 * receive count.
 *
 * The visibility timeout must exceed the consumer's function timeout plus its event source batching
 * window, otherwise a message still being processed becomes visible and is delivered again.
 *
 * Not responsible for wiring the consumer's event source mapping.
 */
export class AuditEventsQueue extends BaseQueue implements IAuditEventsQueueConsumer {
  constructor(scope: Construct, id: string, props: AuditEventsQueueProps = {}) {
    const queueProps = props.queueProps ?? {};

    const dlq = new BaseQueue(scope, `${id}-dlq`, {
      ...queueProps,
      retentionPeriod: Duration.days(14),
    });

    super(scope, id, {
      ...queueProps,
      visibilityTimeout: Duration.minutes(5),
      deadLetterQueue:   {
        queue:           dlq,
        maxReceiveCount: 5,
      },
    });
  }
}
