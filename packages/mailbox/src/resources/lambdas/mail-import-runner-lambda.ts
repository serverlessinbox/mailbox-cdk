import type { IArtifactResolver }          from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                        from '@serverlessinbox/mailbox-cdk-shared';
import type { IGrantable }                 from 'aws-cdk-lib/aws-iam';
import { Duration }                        from 'aws-cdk-lib';
import { Construct }                       from 'constructs';

import type { IDataBlobStore }             from '../buckets/data-blob-store';
import { ImportJobsQueueEvent }            from '../events/import-jobs-queue-event';
import type { IImportJobsQueueConsumer }   from '../queues/import-jobs-queue';
import type { IAuthKeyStoreTable }         from '../tables/auth-key-store-table';
import type { IDataTable }                 from '../tables/data-tables';

/** The mail-import runner's physical name, and the grant that allows invoking it. */
export interface IMailImportRunner {
  /** The function's physical name. */
  readonly functionName: string;

  /** Grants `grantee` permission to invoke the runner. */
  grantInvoke(grantee: IGrantable): void;
}

/** The tables, queue, blob store and artifact resolver the mail-import runner is wired to. The caller creates every resource here. */
export interface MailImportRunnerLambdaProps {
  readonly artifactResolver:  IArtifactResolver;
  readonly itemTable:         IDataTable;
  readonly configTable:       IDataTable;
  readonly changelogTable:    IDataTable;
  readonly blobStore:         IDataBlobStore;
  readonly importJobsQueue:   IImportJobsQueueConsumer;
  readonly authKeyStoreTable: IAuthKeyStoreTable;
}

/**
 * The mail-import runner: consumes import jobs from the import-jobs queue and serves the synchronous connection
 * inspect. It grants itself its tables, the blob write, the queue and the connection private key, and it owns
 * the event source mapping that feeds it.
 */
export class MailImportRunnerLambda extends GoLambda implements IMailImportRunner {
  constructor(scope: Construct, id: string, props: MailImportRunnerLambdaProps) {
    super(scope, id, {
      lambdaId:                     'mail-import-runner',
      pipeline:                     'mail-in',
      artifactResolver:             props.artifactResolver,
      timeout:                      Duration.minutes(5),
      memorySize:                   1024,
      reservedConcurrentExecutions: 3,
      environment:                  {
        ITEM_TABLE_NAME:            props.itemTable.tableName,
        CONFIG_TABLE_NAME:          props.configTable.tableName,
        CHANGELOG_TABLE_NAME:       props.changelogTable.tableName,
        BLOB_STORE_NAME:            props.blobStore.bucketName,
        IMPORT_JOBS_QUEUE_URL:      props.importJobsQueue.queueUrl,
        AUTH_KEY_STORE_TABLE_NAME:  props.authKeyStoreTable.tableName,
        IMPORT_MESSAGES_PER_SECOND: '5',
      },
    });

    props.itemTable.grantReadWrite(this);
    props.configTable.grantRead(this);
    props.changelogTable.grantReadWrite(this);
    props.blobStore.grantEmailBlobWrite(this);
    props.importJobsQueue.grantConsume(this);
    props.importJobsQueue.grantSend(this);
    props.authKeyStoreTable.grantReadConnectionPrivateKey(this);

    new ImportJobsQueueEvent(this, 'import-jobs-queue', { target: this, queue: props.importJobsQueue });
  }
}
