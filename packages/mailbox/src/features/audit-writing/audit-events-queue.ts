import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IGrantable } from 'aws-cdk-lib/aws-iam';
import { BaseQueue, type BaseQueueProps, SqsActions, grantQueueActions } from '@serverlessinbox/mailbox-cdk-shared';

export interface AuditEventsQueueProps {
  /** Optional default props applied to the queue and its DLQ (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Read or read-write access to the audit-events queue without exposing the underlying SQS queue. A
 * holder can request a scoped grant (`grantSend`, `grantConsume`); it cannot reach the raw CDK queue
 * construct through this interface.
 */
export interface IAuditEventsQueue {
  grantSend(grantee: IGrantable): void;

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
export class AuditEventsQueue extends Construct implements IAuditEventsQueue {
  public readonly queue: BaseQueue;
  public readonly dlq: BaseQueue;

  constructor(scope: Construct, id: string, props: AuditEventsQueueProps = {}) {
    super(scope, id);

    const queueProps = props.queueProps ?? {};

    this.dlq = new BaseQueue(this, 'audit-events-dlq-v2', {
      ...queueProps,
      retentionPeriod: Duration.days(14),
    });

    this.queue = new BaseQueue(this, 'audit-events-v2', {
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
