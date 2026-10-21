import { GateOnConditionAspect } from '@serverlessinbox/mailbox-cdk-shared';
import * as targets              from 'aws-cdk-lib/aws-events-targets';
import * as events               from 'aws-cdk-lib/aws-events';
import * as lambda               from 'aws-cdk-lib/aws-lambda';
import * as cdk                  from 'aws-cdk-lib';
import { Construct, IConstruct } from 'constructs';

export interface TrackedUpdateTriggersProps {
  readonly updater: lambda.IFunction;
  readonly isTracking: cdk.CfnCondition;
  readonly updateInterval: cdk.Duration;
}

/**
 * The triggers that run the updater without a person asking: a custom resource that fires on every
 * deploy and a scheduled rule. Every resource in the subtree is gated on `isTracking`; the updater
 * Lambda itself is not part of it.
 */
export class TrackedUpdateTriggers extends Construct {
  private readonly deployEnd: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: TrackedUpdateTriggersProps) {
    super(scope, id);

    this.deployEnd = new cdk.CustomResource(this, 'deploy-end-cr', {
      serviceToken: props.updater.functionArn,
      serviceTimeout: cdk.Duration.seconds(600),
      resourceType: 'Custom::DeployEndTrigger',
      properties: {
        // CloudFormation re-invokes a custom resource only when its properties change; the nonce
        // changes on every synth so the trigger fires on every deploy.
        Nonce: Date.now().toString(),
      },
    });

    new events.Rule(this, 'scheduled-update-rule', {
      schedule: events.Schedule.rate(props.updateInterval),
      targets: [new targets.LambdaFunction(props.updater)],
    });

    cdk.Aspects.of(this).add(new GateOnConditionAspect(props.isTracking));
  }

  /** Makes the deploy-end trigger wait until `dependency` and its whole subtree have been deployed. */
  public waitFor(dependency: IConstruct): void {
    this.deployEnd.node.addDependency(dependency);
  }
}
