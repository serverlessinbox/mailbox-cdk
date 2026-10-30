import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import { JobSweepSchedule }       from '../events/job-sweep-schedule';
import type { IDataTable }        from '../tables/data-tables';

/** The table, periods and artifact resolver the job sweeper is wired to. The caller creates the table. */
export interface JobSweeperLambdaProps {
  readonly artifactResolver: IArtifactResolver;
  readonly itemTable:        IDataTable;
  /** The period between two sweeps. */
  readonly sweepInterval: Duration;
  /** How long a non-terminal job may go without progress before it is failed. */
  readonly staleAfter: Duration;
}

/**
 * The job sweeper: on a schedule, terminalises stale import and export jobs, and removes connections whose
 * time has run out. It reads and writes the item table only.
 */
export class JobSweeperLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: JobSweeperLambdaProps) {
    super(scope, id, {
      lambdaId:         'job-sweeper',
      pipeline:         'infra',
      artifactResolver: props.artifactResolver,
      memorySize:       256,
      timeout:          Duration.minutes(5),
      environment:      {
        ITEM_TABLE_NAME: props.itemTable.tableName,
        JOB_STALE_AFTER: `${props.staleAfter.toSeconds()}s`,
        SWEEP_INTERVAL:  `${props.sweepInterval.toSeconds()}s`,
      },
    });

    props.itemTable.grantReadWrite(this);

    new JobSweepSchedule(this, 'sweep-schedule', { target: this, interval: props.sweepInterval });
  }
}
