import type { IArtifactResolver }                                  from '@serverlessinbox/artifact-registry-cdk';
import type { QueueEncryptionChoice }                              from '@serverlessinbox/mailbox-cdk-shared';
import { applyServerlessInboxComponentTag }                        from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                                                from 'aws-cdk-lib';
import { Construct }                                               from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../../contracts/websocket-push';
import type { IDataBlobStore }                                     from '../../resources/buckets/data-blob-store';
import { JobSweeperLambda }                                        from '../../resources/lambdas/job-sweeper-lambda';
import { MailImportRunnerLambda }                                  from '../../resources/lambdas/mail-import-runner-lambda';
import type { IMailImportRunner }                                  from '../../resources/lambdas/mail-import-runner-lambda';
import type { IAuditEventsQueue }                                  from '../../resources/queues/audit-events-queue';
import { ImportJobsQueue, type IImportJobsQueueConsumer }          from '../../resources/queues/import-jobs-queue';
import type { IAuthKeyStoreTable }                                 from '../../resources/tables/auth-key-store-table';
import type { IPatTable }                                          from '../../resources/tables/data-pat-table';
import type { IDataTable }                                         from '../../resources/tables/data-tables';

/** What {@link JobsSection} uses of the data section. */
export interface IJobsDataInputs {
  readonly itemTable:        IDataTable;
  readonly patTable:         IPatTable;
  readonly configTable:      IDataTable;
  readonly changelogTable:   IDataTable;
  readonly blobStore:        IDataBlobStore;
  readonly auditEventsQueue: IAuditEventsQueue;
}

/** What {@link JobsSection} uses of the auth section. */
export interface IJobsAuthInputs {
  readonly authKeyStoreTable: IAuthKeyStoreTable;
}

/** Props of {@link JobsSection}. */
export interface JobsSectionProps {
  /** The encryption of the import-jobs queue and its DLQ, from the Mailbox encryption plan. */
  readonly queueEncryption:  QueueEncryptionChoice;
  readonly artifactResolver: IArtifactResolver;
  readonly data:             IJobsDataInputs;
  readonly auth:             IJobsAuthInputs;
  /** System sender email address (e.g. noreply@example.com) that the sweeper's token expiry notices are sent from. */
  readonly systemSenderAddress: string;
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

  private readonly mailImportRunnerLambda: IWebSocketPushTarget;
  private readonly jobSweeperLambda:        IWebSocketPushTarget;

  constructor(scope: Construct, id: string, props: JobsSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'data');

    this.importJobsQueue = new ImportJobsQueue(this, 'import-jobs-queue', { encryption: props.queueEncryption });

    const runner                = new MailImportRunnerLambda(this, 'mail-import-runner', {
      artifactResolver:  props.artifactResolver,
      itemTable:         props.data.itemTable,
      configTable:       props.data.configTable,
      changelogTable:    props.data.changelogTable,
      blobStore:         props.data.blobStore,
      importJobsQueue:   this.importJobsQueue,
      authKeyStoreTable: props.auth.authKeyStoreTable,
    });
    this.mailImportRunner       = runner;
    this.mailImportRunnerLambda = runner;

    this.jobSweeperLambda = new JobSweeperLambda(this, 'job-sweeper', {
      artifactResolver:    props.artifactResolver,
      itemTable:           props.data.itemTable,
      patTable:            props.data.patTable,
      configTable:         props.data.configTable,
      changelogTable:      props.data.changelogTable,
      blobStore:           props.data.blobStore,
      auditEventsQueue:    props.data.auditEventsQueue,
      systemSenderAddress: props.systemSenderAddress,
      sweepInterval:       JobsSection.SWEEP_INTERVAL,
      staleAfter:          JobsSection.JOB_STALE_AFTER,
    });
  }

  /** Enables WebSocket push emission from the mail-import runner's and the job sweeper's ChangeTracker. */
  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.mailImportRunnerLambda.enableWebSocketPush(broadcaster);
    this.jobSweeperLambda.enableWebSocketPush(broadcaster);
  }
}
