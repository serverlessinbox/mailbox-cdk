import type { IArtifactResolver }   from '@serverlessinbox/artifact-registry-cdk';
import { TypeScriptLambda }         from '@serverlessinbox/mailbox-cdk-shared';
import * as iam                     from 'aws-cdk-lib/aws-iam';
import { Aws, Duration }            from 'aws-cdk-lib';
import { Construct }                from 'constructs';

import { MAILBOX_ARTIFACT_PACKAGE } from '../../contracts/mailbox-artifact-package';

export interface ResourceSweeperStarterLambdaProps {
  artifactResolver: IArtifactResolver;

  /** ARN of the state machine to start */
  stateMachineArn: string;
}

/**
 * Resource Sweeper Starter Lambda wrapper.
 * Handles CloudFormation custom resource invocations to start the sweeper state machine.
 */
export class ResourceSweeperStarterLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: ResourceSweeperStarterLambdaProps) {
    super(scope, id, {
      lambdaId:         'resource-sweeper',
      pipeline:         'infra',
      serviceName:      'resource-sweeper-starter',
      artifactResolver: props.artifactResolver,
      packageName:      MAILBOX_ARTIFACT_PACKAGE,
      handler:          'index.starterHandler',
      timeout:          Duration.minutes(1),
      memorySize:       256,
      environment:      {
        MAILBOX_SWEEPER_STATE_MACHINE_ARN: props.stateMachineArn,
      },
    });

    this.grantDescribeOwnStack();
  }

  private grantDescribeOwnStack(): void {
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions:   ['cloudformation:DescribeStacks'],
        resources: [Aws.STACK_ID],
      }),
    );
  }
}
