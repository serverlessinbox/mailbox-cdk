import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';

export interface LicenseRefreshScheduleProps {
  target: IFunction;
  hour: string;
  minute: string;
}

/** Invokes the target once a day at the given hour and minute. */
export class LicenseRefreshSchedule extends Rule {
  constructor(scope: Construct, id: string, props: LicenseRefreshScheduleProps) {
    super(scope, id, {
      schedule: Schedule.cron({ hour: props.hour, minute: props.minute }),
      targets: [new LambdaFunction(props.target)],
    });
  }
}
