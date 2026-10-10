import { TypeScriptLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { type IRole } from 'aws-cdk-lib/aws-iam';

export interface ResourceSweeperWorkerLambdaProps {
  artifactResolver: IArtifactResolver;

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
      pipeline: 'infra',
      serviceName: 'resource-sweeper-worker',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      handler: 'index.workerHandler',
      timeout: Duration.minutes(3),
      memorySize: 256,
      role: props.role,
    });
  }
}
