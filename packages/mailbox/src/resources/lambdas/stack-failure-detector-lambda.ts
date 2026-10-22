import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import { IRole }                  from 'aws-cdk-lib/aws-iam';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import { StackFailedEvent }       from '../events/stack-failed-event';
import type { IStackFailedEvent } from '../events/stack-failed-event';

/** Inputs of {@link StackFailureDetectorLambda}. */
export interface StackFailureDetectorLambdaProps {
  readonly artifactResolver: IArtifactResolver;
  /** Pre-created execution role the Lambda runs as. */
  readonly role: IRole;
  /** Explicit function name, not auto-named. */
  readonly functionName: string;
  /** The log group name that this Lambda is granted to read. Must match exactly the log group referenced in the corresponding IAM grant, or read access will fail. */
  readonly infraLogGroupName: string;
}

/**
 * The Go Lambda that detects failed stack operations, running under a pre-created role and an
 * explicit function name.
 *
 * Not responsible for the role's permissions.
 */
export class StackFailureDetectorLambda extends GoLambda {
  readonly stackFailedEvent: IStackFailedEvent;

  constructor(scope: Construct, id: string, props: StackFailureDetectorLambdaProps) {
    super(scope, id, {
      lambdaId:         'stack-failure-detector',
      pipeline:         'infra',
      artifactResolver: props.artifactResolver,
      role:             props.role,
      functionName:     props.functionName,
      timeout:          Duration.minutes(2),
      memorySize:       256,
      environment:      {
        INFRA_LOG_GROUP_NAME: props.infraLogGroupName,
      },
    });

    this.stackFailedEvent = new StackFailedEvent(this, 'stack-failed', { target: this });
  }
}
