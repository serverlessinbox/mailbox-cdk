import { LambdaFunction }   from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule }   from 'aws-cdk-lib/aws-events';
import type { IFunction }   from 'aws-cdk-lib/aws-lambda';
import { Duration }         from 'aws-cdk-lib';
import type { Construct }   from 'constructs';

/** Settings of the schedule that periodically sweeps stale import jobs and expired connections. */
export interface JobSweepScheduleProps {
  /** The function invoked on each sweep; EventBridge is granted permission to invoke it. */
  readonly target: IFunction;
  /** The period between two sweeps. */
  readonly interval: Duration;
}

/** Invokes the target every `interval`, so stale jobs and expired connections are reached without a live invocation. */
export class JobSweepSchedule extends Rule {
  constructor(scope: Construct, id: string, props: JobSweepScheduleProps) {
    super(scope, id, {
      schedule: Schedule.rate(props.interval),
      targets:  [new LambdaFunction(props.target)],
    });
  }
}
