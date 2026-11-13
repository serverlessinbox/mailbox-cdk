import type { IArtifactResolver }                      from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                                    from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                                    from 'aws-cdk-lib';
import { Construct }                                   from 'constructs';

import type { IStateChangeFanout, IStateChangeSource } from '../../contracts/state-change-fanout';
import type { ScopeMap }                               from '../../core/auth/jmap-scopes';
import type { IDataBlobStore }                         from '../buckets/data-blob-store';
import type { IAuditEventsQueue }                      from '../queues/audit-events-queue';
import type { IImportJobsQueue }                       from '../queues/import-jobs-queue';
import type { IAuthKeyStoreTable }                     from '../tables/auth-key-store-table';
import type { IPatTable }                              from '../tables/data-pat-table';
import type { IDataTable }                             from '../tables/data-tables';

import type { IMailImportRunner }                      from './mail-import-runner-lambda';

/**
 * The tables, queues, runner, artifact resolver and OAuth scope map the user-api Lambda is wired to. The caller
 * creates every resource here.
 */
export interface UserApiLambdaProps {
  readonly configTable:       IDataTable;
  readonly itemTable:         IDataTable;
  readonly auditEventsQueue:  IAuditEventsQueue;
  readonly authKeyStoreTable: IAuthKeyStoreTable;
  readonly importJobsQueue:   IImportJobsQueue;
  readonly mailImportRunner:  IMailImportRunner;
  readonly artifactResolver:  IArtifactResolver;
  readonly patTable:          IPatTable;
  readonly blobStore:         IDataBlobStore;
  readonly changelogTable:    IDataTable;
  /** System sender email address (e.g. noreply@example.com) that token notices are sent from. */
  readonly systemSenderAddress: string;
  /** The OAuth scope map; delivered to the Go handler in the OAUTH_HANDLER_CONFIG variable. */
  readonly scopeMap: ScopeMap;
}

/**
 * The user-api Lambda that serves the user preferences API and the remote-connection and import-job RPCs. It grants
 * itself read and write on the item table, read on the config table, send on the audit-events queue, read of the
 * connection public key, send on the import-jobs queue, invoke of the mail-import runner and the condition check the
 * start transaction uses.
 */
export class UserApiLambda extends GoLambda implements IStateChangeSource {
  constructor(scope: Construct, id: string, props: UserApiLambdaProps) {
    super(scope, id, {
      lambdaId:         'user-api',
      pipeline:         'admin',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.seconds(30),
      environment:      {
        CONFIG_TABLE_NAME:                props.configTable.tableName,
        ITEM_TABLE_NAME:                  props.itemTable.tableName,
        AUDIT_EVENTS_QUEUE_URL:           props.auditEventsQueue.queueUrl,
        AUTH_KEY_STORE_TABLE_NAME:        props.authKeyStoreTable.tableName,
        IMPORT_JOBS_QUEUE_URL:            props.importJobsQueue.queueUrl,
        MAIL_IMPORT_RUNNER_FUNCTION_NAME: props.mailImportRunner.functionName,
        OAUTH_HANDLER_CONFIG:             JSON.stringify({ scopeMap: props.scopeMap }),
        PAT_TABLE_NAME:                   props.patTable.tableName,
        BLOB_STORAGE_NAME:                props.blobStore.bucketName,
        CHANGELOG_TABLE_NAME:             props.changelogTable.tableName,
        SYSTEM_SENDER_ADDRESS:            props.systemSenderAddress,
      },
    });

    props.configTable.grantRead(this);
    props.itemTable.grantReadWrite(this);
    props.auditEventsQueue.grantSend(this);
    props.authKeyStoreTable.grantReadConnectionPublicKey(this);
    props.importJobsQueue.grantSend(this);
    props.mailImportRunner.grantInvoke(this);
    props.itemTable.grantConditionCheck(this);
    props.patTable.grantPatManage(this);
    props.blobStore.grantEmailBlobWrite(this);
    props.changelogTable.grantReadWrite(this);
  }

  public enableStateChangeFanout(stateChangeFanout: IStateChangeFanout): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', stateChangeFanout.functionName);
    stateChangeFanout.grantInvoke(this);
  }
}
