import { BaseQueue, type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                       from 'aws-cdk-lib';
import { Construct }                      from 'constructs';

/** Inputs of {@link TantivyIndexingScheduleDlq}. */
export interface TantivyIndexingScheduleDlqProps {
  /** Optional default props applied to the queue (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Read-only identity of the Tantivy indexing schedule's dead-letter queue. No grant method is
 * exposed: EventBridge writes to this queue via a resource policy CDK wires automatically when the
 * queue is passed as a target's `deadLetterQueue`, not an IAM grant to a caller.
 */
export interface ITantivyIndexingScheduleDlq {
  readonly queueArn: string;
}

/**
 * Dead-letter queue for the EventBridge rule that invokes the Tantivy indexer Lambda on a schedule.
 * Captures the EventBridge invocation record when a scheduled indexer invocation fails.
 *
 * Not responsible for retrying or otherwise processing the failed invocations it collects.
 */
export class TantivyIndexingScheduleDlq extends BaseQueue implements ITantivyIndexingScheduleDlq {
  constructor(scope: Construct, id: string, props: TantivyIndexingScheduleDlqProps = {}) {
    super(scope, id, {
      ...props.queueProps,
      retentionPeriod: Duration.days(14),
    });
  }
}
