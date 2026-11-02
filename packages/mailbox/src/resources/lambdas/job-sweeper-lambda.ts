import type { IArtifactResolver }                                  from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                                                from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                                                from 'aws-cdk-lib';
import { Construct }                                               from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../../contracts/websocket-push';
import type { IDataBlobStore }                                     from '../buckets/data-blob-store';
import { JobSweepSchedule }                                        from '../events/job-sweep-schedule';
import type { IAuditEventsQueue }                                  from '../queues/audit-events-queue';
import type { IPatTable }                                          from '../tables/data-pat-table';
import type { IDataTable }                                         from '../tables/data-tables';

/** The table, periods and artifact resolver the job sweeper is wired to. The caller creates the table. */
export interface JobSweeperLambdaProps {
  readonly artifactResolver: IArtifactResolver;
  readonly itemTable:        IDataTable;
  readonly patTable:         IPatTable;
  readonly configTable:      IDataTable;
  readonly changelogTable:   IDataTable;
  readonly blobStore:        IDataBlobStore;
  readonly auditEventsQueue: IAuditEventsQueue;
  /** System sender email address (e.g. noreply@example.com) that token expiry notices are sent from. */
  readonly systemSenderAddress: string;
  /** The period between two sweeps. */
  readonly sweepInterval: Duration;
  /** How long a non-terminal job may go without progress before it is failed. */
  readonly staleAfter: Duration;
}

/**
 * The job sweeper: on a schedule, terminalises stale import and export jobs, and removes connections whose
 * time has run out, and sends the expiry notices of personal access tokens.
 */
export class JobSweeperLambda extends GoLambda implements IWebSocketPushTarget {
  constructor(scope: Construct, id: string, props: JobSweeperLambdaProps) {
    super(scope, id, {
      lambdaId:         'job-sweeper',
      pipeline:         'infra',
      artifactResolver: props.artifactResolver,
      memorySize:       256,
      timeout:          Duration.minutes(5),
      environment:      {
        ITEM_TABLE_NAME:        props.itemTable.tableName,
        PAT_TABLE_NAME:         props.patTable.tableName,
        CONFIG_TABLE_NAME:      props.configTable.tableName,
        BLOB_STORAGE_NAME:      props.blobStore.bucketName,
        CHANGELOG_TABLE_NAME:   props.changelogTable.tableName,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
        SYSTEM_SENDER_ADDRESS:  props.systemSenderAddress,
        JOB_STALE_AFTER:        `${props.staleAfter.toSeconds()}s`,
        SWEEP_INTERVAL:         `${props.sweepInterval.toSeconds()}s`,
      },
    });

    props.itemTable.grantReadWrite(this);
    props.patTable.grantPatExpiryNotify(this);
    props.configTable.grantRead(this);
    props.blobStore.grantEmailBlobWrite(this);
    props.changelogTable.grantReadWrite(this);
    props.auditEventsQueue.grantSend(this);

    new JobSweepSchedule(this, 'sweep-schedule', { target: this, interval: props.sweepInterval });
  }

  public enableWebSocketPush(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }
}
