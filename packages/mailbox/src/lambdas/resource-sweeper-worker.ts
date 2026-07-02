import { TypeScriptLambda } from '../utils/ts-lambda';
import type { ICdkArtifactResolver } from '../artifacts/cdk-artifact-resolver';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { type IRole } from 'aws-cdk-lib/aws-iam';

export interface ResourceSweeperWorkerLambdaProps {
  artifactResolver: ICdkArtifactResolver;

  /** IAM role for the worker Lambda */
  role: IRole;
}

/**
 * Resource Sweeper Worker Lambda wrapper.
 * Handles actual deletion of edge Lambda functions (invoked by state machine).
 */
export class ResourceSweeperWorkerLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: ResourceSweeperWorkerLambdaProps) {
    super(scope, id, {
      lambdaId: 'resource-sweeper',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      handler: 'index.workerHandler',
      timeout: Duration.minutes(3),
      memorySize: 256,
      role: props.role,
    });
  }
}
