import * as targets       from 'aws-cdk-lib/aws-events-targets';
import { Schedule, Rule } from 'aws-cdk-lib/aws-events';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

export interface SupportCollectionScheduleProps {
  target: IFunction;
}

/** Invokes the target hourly, at minute 0. */
export class SupportCollectionSchedule extends Rule {
  constructor(scope: Construct, id: string, props: SupportCollectionScheduleProps) {
    super(scope, id, {
      schedule:    Schedule.cron({ minute: '0' }),
      description: 'Hourly trigger for support role assumption collector and expiry enforcement',
      targets:     [new targets.LambdaFunction(props.target)],
    });
  }
}
