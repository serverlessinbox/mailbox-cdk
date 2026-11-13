import type { IArtifactResolver }                      from '@serverlessinbox/artifact-registry-cdk';
import { applyServerlessInboxComponentTag }            from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                                    from 'aws-cdk-lib';
import { Construct }                                   from 'constructs';

import type { IStateChangeFanout, IStateChangeSource } from '../../contracts/state-change-fanout';
import type { IDataBlobStore }                         from '../../resources/buckets/data-blob-store';
import { ExpirySweeperLambda }                         from '../../resources/lambdas/expiry-sweeper-lambda';
import type { IAuditEventsQueue }                      from '../../resources/queues/audit-events-queue';
import type { IPatTable }                              from '../../resources/tables/data-pat-table';
import type { IDataTable }                             from '../../resources/tables/data-tables';

/** What {@link ExpirySection} uses of the data section. */
export interface IExpiryDataInputs {
  readonly itemTable:        IDataTable;
  readonly patTable:         IPatTable;
  readonly configTable:      IDataTable;
  readonly changelogTable:   IDataTable;
  readonly blobStore:        IDataBlobStore;
  readonly auditEventsQueue: IAuditEventsQueue;
}

/** Props of {@link ExpirySection}. */
export interface ExpirySectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly data:             IExpiryDataInputs;
  /** System sender email address (e.g. noreply@example.com) that the sweeper's token expiry notices are sent from. */
  readonly systemSenderAddress: string;
}

/**
 * The expiry plane: the expiry sweeper, which runs on a schedule. The sweeper is exposed through its narrow
 * state-change source interface.
 */
export class ExpirySection extends Construct {
  private static readonly SWEEP_INTERVAL  = Duration.minutes(15);
  private static readonly JOB_STALE_AFTER = Duration.hours(2);

  private readonly stateChangeSource: IStateChangeSource;

  constructor(scope: Construct, id: string, props: ExpirySectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'data');

    this.stateChangeSource = new ExpirySweeperLambda(this, 'expiry-sweeper', {
      artifactResolver:    props.artifactResolver,
      itemTable:           props.data.itemTable,
      patTable:            props.data.patTable,
      configTable:         props.data.configTable,
      changelogTable:      props.data.changelogTable,
      blobStore:           props.data.blobStore,
      auditEventsQueue:    props.data.auditEventsQueue,
      systemSenderAddress: props.systemSenderAddress,
      sweepInterval:       ExpirySection.SWEEP_INTERVAL,
      staleAfter:          ExpirySection.JOB_STALE_AFTER,
    });
  }

  /** Hands the state changes of the expiry sweeper to the state-change fan-out. */
  public enableStateChangeFanout(stateChangeFanout: IStateChangeFanout): void {
    this.stateChangeSource.enableStateChangeFanout(stateChangeFanout);
  }
}
