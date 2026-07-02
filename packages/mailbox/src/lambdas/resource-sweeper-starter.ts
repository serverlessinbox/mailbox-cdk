import { TypeScriptLambda } from '../utils/ts-lambda';
import type { ICdkArtifactResolver } from '../artifacts/cdk-artifact-resolver';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface ResourceSweeperStarterLambdaProps {
  artifactResolver: ICdkArtifactResolver;

  /** ARN of the state machine to start */
  stateMachineArn: string;

  /** Root stack name */
  rootStackName: string;
}

/**
 * Resource Sweeper Starter Lambda wrapper.
 * Handles CloudFormation custom resource invocations to start the sweeper state machine.
 */
export class ResourceSweeperStarterLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: ResourceSweeperStarterLambdaProps) {
    super(scope, id, {
      lambdaId: 'resource-sweeper',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      handler: 'index.starterHandler',
      timeout: Duration.minutes(1),
      memorySize: 256,
      environment: {
        MAILBOX_SWEEPER_STATE_MACHINE_ARN: props.stateMachineArn,
        MAILBOX_SWEEPER_ROOT_STACK_NAME: props.rootStackName,
      },
    });
  }
}
