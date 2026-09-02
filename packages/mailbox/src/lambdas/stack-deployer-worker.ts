import { TypeScriptLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface StackDeployerWorkerLambdaProps {
  artifactResolver: ICdkArtifactEngine;

  /** SERVICE_NAME for this physical function; distinguishes it from other StackDeployerWorkerLambda instances sharing the 'stack-deployer' lambdaId. */
  serviceName: string;
}

/**
 * Stack Deployer Worker Lambda wrapper.
 * Performs CloudFormation operations and polls for completion (invoked by state machine).
 */
export class StackDeployerWorkerLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: StackDeployerWorkerLambdaProps) {
    super(scope, id, {
      lambdaId: 'stack-deployer',
      pipeline: 'infra',
      serviceName: props.serviceName,
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      handler: 'index.workerHandler',
      timeout: Duration.minutes(15),
      memorySize: 512,
    });
  }
}
