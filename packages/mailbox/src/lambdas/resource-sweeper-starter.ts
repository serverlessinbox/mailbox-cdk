import { TypeScriptLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Aws, Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ResourceSweeperEnvNames, type ResourceSweeperEnvName } from '../ts-lambdas/resource-sweeper/env-names';

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
      lambdaId: 'resource-sweeper',
      pipeline: 'infra',
      serviceName: 'resource-sweeper-starter',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      handler: 'index.starterHandler',
      timeout: Duration.minutes(1),
      memorySize: 256,
      environment: ResourceSweeperStarterLambda.environmentOf(props),
    });

    this.grantDescribeOwnStack();
  }

  private static environmentOf(props: ResourceSweeperStarterLambdaProps): Record<ResourceSweeperEnvName, string> {
    return {
      [ResourceSweeperEnvNames.stateMachineArn]: props.stateMachineArn,
    };
  }

  private grantDescribeOwnStack(): void {
    this.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [Aws.STACK_ID],
      }),
    );
  }
}
