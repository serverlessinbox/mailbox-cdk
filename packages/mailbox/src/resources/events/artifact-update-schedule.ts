import * as targets       from 'aws-cdk-lib/aws-events-targets';
import { Schedule, Rule } from 'aws-cdk-lib/aws-events';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { Duration }  from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface ArtifactUpdateScheduleProps {
  target: IFunction;
  interval: Duration;
}

/** Invokes the target at a fixed interval. */
export class ArtifactUpdateSchedule extends Rule {
  constructor(scope: Construct, id: string, props: ArtifactUpdateScheduleProps) {
    super(scope, id, {
      schedule: Schedule.rate(props.interval),
      targets: [new targets.LambdaFunction(props.target)],
    });
  }
}
