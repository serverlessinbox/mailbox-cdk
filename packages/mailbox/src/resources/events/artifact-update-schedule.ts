import * as targets       from 'aws-cdk-lib/aws-events-targets';
import { Schedule, Rule } from 'aws-cdk-lib/aws-events';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { Duration }  from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/** Settings of the schedule that periodically invokes an artifact-update function. */
export interface ArtifactUpdateScheduleProps {
  /** The function invoked on every tick; EventBridge is granted permission to invoke it. */
  readonly target:   IFunction;
  /** Time between two invocations, applied as a fixed-rate schedule. EventBridge rejects a rate below one minute. */
  readonly interval: Duration;
}

/** Invokes the target at a fixed interval. */
export class ArtifactUpdateSchedule extends Rule {
  constructor(scope: Construct, id: string, props: ArtifactUpdateScheduleProps) {
    super(scope, id, {
      schedule: Schedule.rate(props.interval),
      targets:  [new targets.LambdaFunction(props.target)],
    });
  }
}
