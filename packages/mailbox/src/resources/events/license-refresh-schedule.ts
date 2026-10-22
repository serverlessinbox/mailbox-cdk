import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

/** Settings of the daily schedule that refreshes the license. */
export interface LicenseRefreshScheduleProps {
  /** The function invoked once a day; EventBridge is granted permission to invoke it. */
  readonly target: IFunction;
  /** Hour of the day (UTC, as EventBridge cron expressions are) of the invocation, as a cron hour field such as `'13'`. */
  readonly hour:   string;
  /** Minute of the hour of the invocation, as a cron minute field such as `'47'`. */
  readonly minute: string;
}

/** Invokes the target once a day at the given hour and minute. */
export class LicenseRefreshSchedule extends Rule {
  constructor(scope: Construct, id: string, props: LicenseRefreshScheduleProps) {
    super(scope, id, {
      schedule: Schedule.cron({ hour: props.hour, minute: props.minute }),
      targets:  [new LambdaFunction(props.target)],
    });
  }
}
