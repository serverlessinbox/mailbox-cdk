import { TypeScriptLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface CognitoDeployerStarterLambdaProps {
  artifactResolver: ICdkArtifactEngine;

  /** ARN of the state machine to start */
  stateMachineArn: string;
}

/**
 * Cognito Data Deployer Starter Lambda wrapper.
 * Handles CloudFormation custom resource invocations to start the deployer state machine.
 */
export class CognitoDeployerStarterLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: CognitoDeployerStarterLambdaProps) {
    super(scope, id, {
      lambdaId: 'stack-deployer',
      serviceName: 'stack-deployer-cognito-starter',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      handler: 'index.starterHandler',
      timeout: Duration.minutes(1),
      memorySize: 256,
      environment: {
        MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN: props.stateMachineArn,
      },
    });
  }
}
