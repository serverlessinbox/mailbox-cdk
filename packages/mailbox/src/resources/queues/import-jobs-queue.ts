import { BaseQueue, type QueueEncryptionChoice } from '@serverlessinbox/mailbox-cdk-shared';
import type { IGrantable }                       from 'aws-cdk-lib/aws-iam';
import { Duration }                              from 'aws-cdk-lib';
import { Construct }                             from 'constructs';

/** Props of {@link ImportJobsQueue}. */
export interface ImportJobsQueueProps {
  /** The encryption of the queue and its DLQ. */
  readonly encryption: QueueEncryptionChoice;
}

/**
 * Send-only access to the import-jobs queue, without exposing the underlying SQS queue construct. A
 * holder enqueues a job message and builds its own queue URL environment variable; it cannot consume.
 */
export interface IImportJobsQueue {
  /** The queue's URL, in the exact form the AWS SDK's `SendMessage` call expects. */
  readonly queueUrl: string;

  /** The queue's ARN, needed to wire a consumer's own SQS event source mapping. */
  readonly queueArn: string;

  /** Grants `sqs:SendMessage` on this queue. Call it from inside the grantee's own construct. */
  grantSend(grantee: IGrantable): void;
}

/** {@link IImportJobsQueue} extended with consume access, for the queue's single consumer. */
export interface IImportJobsQueueConsumer extends IImportJobsQueue {
  grantConsume(grantee: IGrantable): void;
}

/**
 * SQS queue carrying mail-import job messages to the runner, backed by a dead-letter queue created
 * beside it. A message moves to the dead-letter queue after 3 receives and is kept for 14 days.
 *
 * The visibility timeout is the base queue's default (6 minutes). Not responsible for wiring the
 * consumer's event source mapping.
 */
export class ImportJobsQueue extends BaseQueue implements IImportJobsQueueConsumer {
  constructor(scope: Construct, id: string, props: ImportJobsQueueProps) {
    const dlq = new BaseQueue(scope, `${id}-dlq`, {
      encryption:      props.encryption,
      retentionPeriod: Duration.days(14),
    });

    super(scope, id, {
      encryption:      props.encryption,
      deadLetterQueue: {
        queue:           dlq,
        maxReceiveCount: 3,
      },
    });
  }
}
