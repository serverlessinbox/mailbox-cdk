import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Duration }       from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/** Settings of the schedule that periodically invokes the expiry sweeper. */
export interface ExpirySweepScheduleProps {
  /** The function invoked on each sweep; EventBridge is granted permission to invoke it. */
  readonly target: IFunction;
  /** The period between two sweeps. */
  readonly interval: Duration;
}

/**
 * Invokes the expiry sweeper every `interval`. Each invocation runs four passes: overdue import jobs are failed,
 * expired remote connections are removed, personal access token expiry notices are sent (gated to once a day),
 * and push subscription expiry runs on every invocation.
 */
export class ExpirySweepSchedule extends Rule {
  constructor(scope: Construct, id: string, props: ExpirySweepScheduleProps) {
    super(scope, id, {
      schedule: Schedule.rate(props.interval),
      targets:  [new LambdaFunction(props.target)],
    });
  }
}
