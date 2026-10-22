import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Duration }       from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/** Settings of the schedule that periodically refreshes cached signing keys. */
export interface AuthKeyRefreshScheduleProps {
  /** The function invoked every 6 hours to refresh the signing keys; EventBridge is granted permission to invoke it. */
  readonly target: IFunction;
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
