import { Aws, Fn, Stack, ArnFormat } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import type { ICdkArtifactEngine } from '../artifact-engine';
import { DeployerStarterLambda } from './deployer-starter-lambda';
import { PollingCfnDeployerWorkflow } from './polling-cfn-deployer-workflow';

export interface DeployerInfraProps {
  readonly artifactResolver: ICdkArtifactEngine;
  /**
   * Prefix for the Step Functions state machine name, e.g. 'mailbox-data-deployer-'.
   * The stack GUID is appended to keep the name unique and under 80 chars.
   */
  readonly stateMachineNamePrefix: string;

  /**
   * Which sub-stack deployer this instance drives (e.g. 'data', 'edge', 'cognito').
   * Composes into the starter's `SERVICE_NAME` (e.g. `stack-deployer-data-starter`)
   * so distinct physical functions sharing the `stack-deployer` lambdaId stay attributable.
   */
  readonly parent: string;

  /**
   * Builds this deployer's domain-specific worker Lambda. Called by `DeployerInfra` at the fixed
   * id `'worker'` so every deployer's worker keeps the same construct path (and logical ID)
   * regardless of which concrete worker subclass it builds — the caller owns the worker's IAM
   * grants (applied inside its own constructor), `DeployerInfra` only owns where it is parented.
   */
  readonly createWorker: (scope: Construct, id: string) => IFunction;
}

/**
 * Shared scaffolding for deployer constructs that use a Step Functions workflow
 * to drive long-running CloudFormation operations via a custom resource.
 *
 * Creates:
 * - `worker` — the caller's domain-specific `DeployerWorkerLambda` subclass, built by
 *   `props.createWorker` and parented at the fixed id `'worker'`
 * - `workflow` PollingCfnDeployerWorkflow (20s check interval, 90 min timeout)
 * - `starter` TypeScriptLambda (1 min / 256 MB) — custom resource entrypoint
 *
 * The starter is wired with the state machine ARN env var and `states:StartExecution` /
 * `states:DescribeExecution` IAM policies. The worker's domain IAM policies are applied by the
 * caller's worker subclass, inside its own constructor. The caller must also create the
 * CustomResource and call `resource.node.addDependency(infra.workflow.stateMachine)`.
 */
export class DeployerInfra extends Construct {
  public readonly worker: IFunction;
  public readonly starter: IFunction;
  public readonly workflow: PollingCfnDeployerWorkflow;

  constructor(scope: Construct, id: string, props: DeployerInfraProps) {
    super(scope, id);

    // Worker Lambda: performs CloudFormation operations and polls for completion. The caller
    // builds its own domain-specific worker subclass (carrying its own IAM grants); this
    // construct only fixes where it is parented ('worker') so every deployer's construct path
    // stays identical regardless of which worker subclass is built.
    this.worker = props.createWorker(this, 'worker');

    // Step Functions state machine name, derived from the stack GUID for uniqueness.
    // StackId is an ARN: arn:aws:cloudformation:region:acct:stack/stack-name/guid
    const stackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
    const stateMachineName = Fn.join('', [props.stateMachineNamePrefix, stackGuid]);

    this.workflow = new PollingCfnDeployerWorkflow(this, 'workflow', {
      handler: this.worker,
      stateMachineName,
    });

    // Starter Lambda: CFN custom resource entrypoint — only starts the Step Functions execution.
    this.starter = new DeployerStarterLambda(this, 'starter', {
      artifactResolver: props.artifactResolver,
      stateMachineArn: this.workflow.stateMachine.stateMachineArn,
      serviceName: `stack-deployer-${props.parent}-starter`,
    });

    this.starter.addToRolePolicy(
      new PolicyStatement({
        actions: ['states:StartExecution'],
        resources: [this.workflow.stateMachine.stateMachineArn],
      }),
    );

    // Grant DescribeExecution permission on execution ARNs (needed to detect and retry on ExecutionAlreadyExists).
    // Execution ARNs use colon format: arn:aws:states:region:account:execution:stateMachineName:*
    // Build ARN token-safely from the same name source used for the state machine.
    const stack = Stack.of(this);
    const executionArnPattern = stack.formatArn({
      service: 'states',
      resource: 'execution',
      resourceName: Fn.join(':', [stateMachineName, '*']),
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
    this.starter.addToRolePolicy(
      new PolicyStatement({
        actions: ['states:DescribeExecution'],
        resources: [executionArnPattern],
      }),
    );
  }
}
