import { CustomResource, Duration, Fn } from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { StackIdentity } from '../naming/stack-identity';
import type { StackDeployerProperties } from '../ts-lambdas/stack-deployer/stack-deployment';
import { DeployerStarterLambda } from './deployer-starter-lambda';
import { PollingCfnDeployerWorkflow } from './polling-cfn-deployer-workflow';

const DEPLOY_STACK_SERVICE_TIMEOUT = Duration.hours(1);

export interface DeployerInfraProps {
  readonly artifactResolver: IArtifactResolver;
  /**
   * Prefix for the Step Functions state machine name, e.g. 'mailbox-data-deployer-'.
   * The stack GUID is appended to keep the name unique and under 80 chars.
   */
  readonly stateMachineNamePrefix: string;

  /** The name of the stack this deployer deploys, e.g. 'data'. Composes into the starter's `SERVICE_NAME`. */
  readonly deployedStackName: string;

  /** ARN pattern of the stack this deployer deploys, e.g. `arn:...:stack/<name>/*`. */
  readonly deployedStackArn: string;

  /**
   * Builds this deployer's worker Lambda. Called at the fixed id `'worker'`, so every deployer's
   * worker keeps the same construct path (and logical ID) whichever worker subclass it builds. The
   * worker applies its own IAM grants in its constructor.
   */
  readonly createWorker: (scope: Construct, id: string) => IFunction;
}

/**
 * The scaffolding every sub-stack deployer shares: a worker Lambda that performs the CloudFormation
 * operations, a Step Functions workflow that polls it until they finish, and a starter Lambda that
 * answers the deployer's custom resource by starting the workflow.
 */
export class DeployerInfra extends Construct {
  private readonly workflow: PollingCfnDeployerWorkflow;
  private readonly starterArn: string;

  constructor(scope: Construct, id: string, props: DeployerInfraProps) {
    super(scope, id);

    const worker = props.createWorker(this, 'worker');

    this.workflow = new PollingCfnDeployerWorkflow(this, 'workflow', {
      handler: worker,
      stateMachineName: this.stateMachineName(props.stateMachineNamePrefix),
    });

    const starter = new DeployerStarterLambda(this, 'starter', {
      artifactResolver: props.artifactResolver,
      workflow: this.workflow,
      deployedStackName: props.deployedStackName,
      deployedStackArn: props.deployedStackArn,
    });
    this.starterArn = starter.functionArn;
  }

  /**
   * Creates the custom resource that deploys one stack through this infrastructure, as `scope`'s
   * child `'resource'`. The resource depends on the workflow, so the workflow outlives it and can
   * still answer its delete.
   */
  public deployStack(scope: Construct, resourceType: string, properties: StackDeployerProperties): CustomResource {
    const resource = new CustomResource(scope, 'resource', {
      serviceToken: this.starterArn,
      resourceType,
      serviceTimeout: DEPLOY_STACK_SERVICE_TIMEOUT,
      properties,
    });

    resource.node.addDependency(this.workflow.stateMachineDependable);

    return resource;
  }

  /** StackId is an ARN, `arn:aws:cloudformation:region:account:stack/stack-name/guid`; its guid keeps the name unique across stacks. */
  private stateMachineName(prefix: string): string {
    return Fn.join('', [prefix, StackIdentity.guid]);
  }
}
