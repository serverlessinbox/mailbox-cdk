import type { IArtifactResolver }           from '@serverlessinbox/artifact-registry-cdk';
import { PolicyStatement }                  from 'aws-cdk-lib/aws-iam';
import { Duration }                         from 'aws-cdk-lib';
import { Construct }                        from 'constructs';

import { parentStackStatusReadStatement }   from '../../grants/parent-stack-status-read';
import type { IPollingCfnDeployerWorkflow } from '../workflows/polling-cfn-deployer-workflow';

import { TypeScriptLambda }                 from './ts-lambda';

/** What `DeployerStarterLambda` needs: the workflow it starts and the stack that deployer deploys. */
export interface DeployerStarterLambdaProps {
  readonly artifactResolver: IArtifactResolver;
  readonly workflow: IPollingCfnDeployerWorkflow;
  /** Composes into `SERVICE_NAME`, which keeps each deployer's function distinguishable while they share the 'stack-deployer' lambdaId. */
  readonly deployedStackName: string;
  /** ARN pattern of the stack this deployer deploys; the only stack besides the parent that the starter may read. */
  readonly deployedStackArn: string;
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
    this.grantReadParentStackStatus();
    this.grantDeployedStackRead(props.deployedStackArn);
  }

  /** Lets the starter ask whether the parent stack is rolling back before it answers a failed Update. */
  private grantReadParentStackStatus(): void {
    this.addToRolePolicy(parentStackStatusReadStatement());
  }

  /** Lets the starter read the outputs of the deployed stack when it answers a failed Update during a parent rollback. */
  private grantDeployedStackRead(deployedStackArn: string): void {
    this.addToRolePolicy(
      new PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [deployedStackArn],
      }),
    );
  }
}
