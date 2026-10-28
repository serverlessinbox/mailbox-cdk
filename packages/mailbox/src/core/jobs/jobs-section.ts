import type { BaseQueueProps }                            from '@serverlessinbox/mailbox-cdk-shared';
import { applyServerlessInboxComponentTag }               from '@serverlessinbox/mailbox-cdk-shared';
import { Construct }                                      from 'constructs';

import { ImportJobsQueue, type IImportJobsQueueConsumer } from '../../resources/queues/import-jobs-queue';

/** Props of {@link JobsSection}. */
export interface JobsSectionProps {
  /** SQS defaults from the Mailbox encryption plan, applied to the import-jobs queue and its DLQ. */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * The mail-import data plane: the import-jobs queue with its dead-letter queue.
 * The queue is exposed through its narrow interface for the consumers that grant on it.
 */
export class JobsSection extends Construct {
  public readonly importJobsQueue: IImportJobsQueueConsumer;

  constructor(scope: Construct, id: string, props: JobsSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'data');

    this.importJobsQueue = new ImportJobsQueue(this, 'import-jobs-queue', { queueProps: props.queueProps });
  }
}
