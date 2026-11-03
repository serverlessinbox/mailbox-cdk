import { EventSourceMapping }            from 'aws-cdk-lib/aws-lambda';
import type { IFunction }                from 'aws-cdk-lib/aws-lambda';
import type { Construct }                from 'constructs';

import type { IImportJobsQueueConsumer } from '../queues/import-jobs-queue';

/** Settings of the mapping that feeds import jobs from the import-jobs queue to the runner. */
export interface ImportJobsQueueEventProps {
  /** The function that receives each import job. */
  readonly target: IFunction;
  /** The queue the import jobs are read from, seen from the consuming side. */
  readonly queue: IImportJobsQueueConsumer;
}

/**
 * Invokes the target with one import job per batch. At most two invocations run at once. A failed record is
 * reported by message, so the other records of a batch are not retried with it.
 */
export class ImportJobsQueueEvent extends EventSourceMapping {
  constructor(scope: Construct, id: string, props: ImportJobsQueueEventProps) {
    super(scope, id, {
      target:                  props.target,
      eventSourceArn:          props.queue.queueArn,
      batchSize:               1,
      reportBatchItemFailures: true,
      maxConcurrency:          2,
    });
  }
}
