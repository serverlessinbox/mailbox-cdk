import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { TypeScriptLambda } from '../ts-lambda';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { IPollingCfnDeployerWorkflow } from './polling-cfn-deployer-workflow';

export interface DeployerStarterLambdaProps {
  readonly artifactResolver: IArtifactResolver;
  readonly workflow: IPollingCfnDeployerWorkflow;
  /** Composes into `SERVICE_NAME`, which keeps each deployer's function distinguishable while they share the 'stack-deployer' lambdaId. */
  readonly deployedStackName: string;
}

/**
 * The Lambda that answers a deployer's CloudFormation custom resource by starting an execution of
 * the deployer workflow. It does no stack work itself.
 */
export class DeployerStarterLambda extends TypeScriptLambda {
  constructor(scope: Construct, id: string, props: DeployerStarterLambdaProps) {
    super(scope, id, {
      lambdaId: 'stack-deployer',
      pipeline: 'infra',
      serviceName: `stack-deployer-${props.deployedStackName}-starter`,
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk-shared',
      handler: 'index.starterHandler',
      timeout: Duration.minutes(1),
      memorySize: 256,
      environment: {
        MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN: props.workflow.stateMachineArn,
      },
    });

    props.workflow.grantStartAndDescribeExecutions(this);
  }
}
