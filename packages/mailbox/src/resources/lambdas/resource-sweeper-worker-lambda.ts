import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda }       from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                   from 'aws-cdk-lib/aws-iam';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

/** Inputs of {@link ResourceSweeperWorkerLambda}. */
export interface ResourceSweeperWorkerLambdaProps {
  readonly artifactResolver: IArtifactResolver;

  /** IAM role for the worker Lambda */
  readonly role: iam.IRole;
}

/**
 * Resource Sweeper Worker Lambda wrapper.
 * Deletes the resources of one removal target per invocation and reports whether the target is gone.
 */
export class ResourceSweeperWorkerLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: ResourceSweeperWorkerLambdaProps) {
    super(scope, id, {
      lambdaId:         'resource-sweeper',
      pipeline:         'infra',
      serviceName:      'resource-sweeper-worker',
      artifactResolver: props.artifactResolver,
      packageName:      'mailbox-cdk',
      handler:          'index.workerHandler',
      timeout:          Duration.minutes(3),
      memorySize:       256,
      role:             props.role,
    });
  }
}
