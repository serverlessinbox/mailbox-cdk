import type { IArtifactResolver }                                    from '@serverlessinbox/artifact-registry-cdk';
import type { BaseQueueProps }                                       from '@serverlessinbox/mailbox-cdk-shared';
import { applyServerlessInboxComponentTag }                          from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                                                  from 'aws-cdk-lib';
import { Construct }                                                 from 'constructs';

import type { IDataBlobStore }                                       from '../../resources/buckets/data-blob-store';
import { JobSweeperLambda }                                          from '../../resources/lambdas/job-sweeper-lambda';
import { MailImportRunnerLambda }                                    from '../../resources/lambdas/mail-import-runner-lambda';
import type { IMailImportRunner }                                    from '../../resources/lambdas/mail-import-runner-lambda';
import { ImportJobsQueue, type IImportJobsQueueConsumer }            from '../../resources/queues/import-jobs-queue';
import type { IAuthKeyStoreTable }                                   from '../../resources/tables/auth-key-store-table';
import type { IDataTable }                                           from '../../resources/tables/data-tables';

/** What {@link JobsSection} uses of the data section. */
export interface IJobsDataInputs {
  readonly itemTable:      IDataTable;
  readonly configTable:    IDataTable;
  readonly changelogTable: IDataTable;
  readonly blobStore:      IDataBlobStore;
}

/** What {@link JobsSection} uses of the auth section. */
export interface IJobsAuthInputs {
  readonly authKeyStoreTable: IAuthKeyStoreTable;
}

/** Props of {@link JobsSection}. */
export interface JobsSectionProps {
  /** SQS defaults from the Mailbox encryption plan, applied to the import-jobs queue and its DLQ. */
  readonly queueProps?:      Partial<BaseQueueProps>;
  readonly artifactResolver: IArtifactResolver;
  readonly data:             IJobsDataInputs;
  readonly auth:             IJobsAuthInputs;
}

/**
 * The mail-import data plane: the import-jobs queue with its dead-letter queue, the runner that consumes it and
 * the sweeper that terminalises stale jobs. The queue and the runner are exposed through their narrow interfaces.
 */
export class JobsSection extends Construct {
  private static readonly SWEEP_INTERVAL  = Duration.minutes(15);
  private static readonly JOB_STALE_AFTER = Duration.hours(2);

  public readonly importJobsQueue: IImportJobsQueueConsumer;
  public readonly mailImportRunner: IMailImportRunner;

  constructor(scope: Construct, id: string, props: JobsSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'data');

    this.importJobsQueue = new ImportJobsQueue(this, 'import-jobs-queue', { queueProps: props.queueProps });

    this.mailImportRunner = new MailImportRunnerLambda(this, 'mail-import-runner', {
      artifactResolver:  props.artifactResolver,
      itemTable:         props.data.itemTable,
      configTable:       props.data.configTable,
      changelogTable:    props.data.changelogTable,
      blobStore:         props.data.blobStore,
      importJobsQueue:   this.importJobsQueue,
      authKeyStoreTable: props.auth.authKeyStoreTable,
    });

    new JobSweeperLambda(this, 'job-sweeper', {
      artifactResolver: props.artifactResolver,
      itemTable:        props.data.itemTable,
      sweepInterval:    JobsSection.SWEEP_INTERVAL,
      staleAfter:       JobsSection.JOB_STALE_AFTER,
    });
  }
}
