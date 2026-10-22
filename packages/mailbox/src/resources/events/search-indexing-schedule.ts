import * as targets       from 'aws-cdk-lib/aws-events-targets';
import { Schedule, Rule } from 'aws-cdk-lib/aws-events';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { IQueue }    from 'aws-cdk-lib/aws-sqs';
import { Duration }       from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/** Settings of the schedule that periodically triggers search indexing. */
export interface SearchIndexingScheduleProps {
  /** The function invoked every 6 hours to index; EventBridge is granted permission to invoke it. */
  readonly target:          IFunction;
  /** Receives the invocations EventBridge could not deliver to the target; EventBridge is granted permission to send to it. */
  readonly deadLetterQueue: IQueue;
}

/** Invokes the target every 6 hours; invocations EventBridge cannot deliver go to the dead-letter queue. */
export class SearchIndexingSchedule extends Rule {
  constructor(scope: Construct, id: string, props: SearchIndexingScheduleProps) {
    super(scope, id, {
      schedule:    Schedule.rate(Duration.hours(6)),
      description: 'Trigger Tantivy indexing every 6 hours',
      targets:     [new targets.LambdaFunction(props.target, { deadLetterQueue: props.deadLetterQueue })],
    });
  }
}
