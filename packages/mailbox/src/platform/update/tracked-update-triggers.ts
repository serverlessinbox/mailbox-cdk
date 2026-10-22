import { GateOnConditionAspect } from '@serverlessinbox/mailbox-cdk-shared';
import * as lambda               from 'aws-cdk-lib/aws-lambda';
import * as cdk                  from 'aws-cdk-lib';
import { Construct, IConstruct } from 'constructs';

export interface TrackedUpdateTriggersProps {
  readonly updater:    lambda.IFunction;
  readonly isTracking: cdk.CfnCondition;
}

/**
 * The trigger that runs the updater after every deploy: a custom resource. Every resource in the
 * subtree is gated on `isTracking`; the updater Lambda itself is not part of it.
 */
export class TrackedUpdateTriggers extends Construct {
  private readonly deployEnd: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: TrackedUpdateTriggersProps) {
    super(scope, id);

    this.deployEnd = new cdk.CustomResource(this, 'deploy-end-cr', {
      serviceToken:   props.updater.functionArn,
      serviceTimeout: cdk.Duration.seconds(600),
      resourceType:   'Custom::DeployEndTrigger',
      properties:     {
        // CloudFormation re-invokes a custom resource only when its properties change; the nonce
        // changes on every synth so the trigger fires on every deploy.
        Nonce: Date.now().toString(),
      },
    });

    cdk.Aspects.of(this).add(new GateOnConditionAspect(props.isTracking));
  }

  /** Makes the deploy-end trigger wait until `dependency` and its whole subtree have been deployed. */
  public waitFor(dependency: IConstruct): void {
    this.deployEnd.node.addDependency(dependency);
  }
}
