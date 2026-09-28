import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IRole } from 'aws-cdk-lib/aws-iam';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';

export interface StackFailureDetectorLambdaProps {
  readonly artifactResolver: ICdkArtifactEngine;
  /** Pre-created (see stack-failure-detection-infra.ts for why). */
  readonly role: IRole;
  /** Pinned, not auto-named (see stack-failure-detection-infra.ts for why). */
  readonly functionName: string;
  /** The log group name that this Lambda is granted to read. Must match exactly the log group referenced in the corresponding IAM grant, or read access will fail. */
  readonly infraLogGroupName: string;
}

export class StackFailureDetectorLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: StackFailureDetectorLambdaProps) {
    super(scope, id, {
      lambdaId: 'stack-failure-detector',
      pipeline: 'infra',
      artifactResolver: props.artifactResolver,
      role: props.role,
      functionName: props.functionName,
      timeout: Duration.minutes(2),
      memorySize: 256,
      environment: {
        INFRA_LOG_GROUP_NAME: props.infraLogGroupName,
      },
    });
  }
}
