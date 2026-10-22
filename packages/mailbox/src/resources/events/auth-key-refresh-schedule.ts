import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Duration }       from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface AuthKeyRefreshScheduleProps {
  target: IFunction;
}

/** Invokes the target every 6 hours, keeping the cached signing keys fresh through key rotation. */
export class AuthKeyRefreshSchedule extends Rule {
  constructor(scope: Construct, id: string, props: AuthKeyRefreshScheduleProps) {
    super(scope, id, {
      schedule: Schedule.rate(Duration.hours(6)),
      targets:  [new LambdaFunction(props.target)],
    });
  }
}
