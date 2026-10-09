import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { TypeScriptLambda } from '../ts-lambda';
import type { ICdkArtifactEngine } from '../artifact-engine';

export interface DeployerWorkerLambdaProps {
  readonly artifactResolver: ICdkArtifactEngine;

  /** SERVICE_NAME for this physical function; distinguishes it from other DeployerWorkerLambda instances sharing the 'stack-deployer' lambdaId. */
  readonly serviceName: string;
}

/**
 * Stack deployer worker Lambda wrapper, shared by every sub-stack deployer (mailbox data,
 * mailbox edge, cognito data). Performs CloudFormation operations and polls for completion
 * (invoked by the deployer state machine).
 */
export class DeployerWorkerLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: DeployerWorkerLambdaProps) {
    // Must register the package BEFORE calling super(), which will try to resolve.
    // Idempotent (Set-backed).
    props.artifactResolver.registerPackages(['mailbox-cdk-shared']);

    super(scope, id, {
      lambdaId: 'stack-deployer',
      pipeline: 'infra',
      serviceName: props.serviceName,
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk-shared',
      handler: 'index.workerHandler',
      timeout: Duration.minutes(15),
      memorySize: 512,
    });
  }
}
