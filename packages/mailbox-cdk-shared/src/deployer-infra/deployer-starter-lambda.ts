import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { TypeScriptLambda } from '../ts-lambda';
import type { ICdkArtifactEngine } from '../artifact-engine';

export interface DeployerStarterLambdaProps {
  readonly artifactResolver: ICdkArtifactEngine;

  /** ARN of the state machine to start. */
  readonly stateMachineArn: string;

  /** SERVICE_NAME for this physical function; distinguishes it from other DeployerStarterLambda instances sharing the 'stack-deployer' lambdaId. */
  readonly serviceName: string;
}

/**
 * Stack deployer starter Lambda wrapper, shared by every sub-stack deployer (mailbox data,
 * mailbox edge, cognito data). Handles CloudFormation custom resource invocations to start
 * the deployer state machine.
 */
export class DeployerStarterLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: DeployerStarterLambdaProps) {
    // Must register the package BEFORE calling super(), which will try to resolve.
    // Idempotent (Set-backed).
    props.artifactResolver.registerPackages(['mailbox-cdk-shared']);

    super(scope, id, {
      lambdaId: 'stack-deployer',
      pipeline: 'infra',
      serviceName: props.serviceName,
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk-shared',
      handler: 'index.starterHandler',
      timeout: Duration.minutes(1),
      memorySize: 256,
      environment: {
        MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN: props.stateMachineArn,
      },
    });
  }
}
