import { Aws, Duration, Fn, Stack, ArnFormat } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { StackDeployerWorkerLambda } from '../../lambdas/stack-deployer-worker';
import { StackDeployerStarterLambda } from '../../lambdas/stack-deployer-starter';
import { MailboxStackDeployerWorkflow } from './stack-deployer-workflow';

export interface StackDeployerInfraProps {
  readonly artifactResolver: ICdkArtifactEngine;
  /**
   * Prefix for the Step Functions state machine name, e.g. 'MailboxDataDeployer-'.
   * The stack GUID is appended to keep the name unique and under 80 chars.
   */
  readonly stateMachineNamePrefix: string;
}

/**
 * Shared scaffolding for deployer constructs that use a Step Functions workflow
 * to drive long-running CloudFormation operations via a custom resource.
 *
 * Creates:
 * - `worker` TypeScriptLambda (15 min / 512 MB) — executes CloudFormation operations
 * - `workflow` MailboxStackDeployerWorkflow (20s check interval, 90 min timeout)
 * - `starter` TypeScriptLambda (1 min / 256 MB) — custom resource entrypoint
 *
 * The starter is wired with the state machine ARN env var and `states:StartExecution`
 * IAM policy. Worker IAM policies for the specific resources are the caller's responsibility.
 * The caller must also create the CustomResource and call
 * `resource.node.addDependency(infra.workflow.stateMachine)`.
 */
export class StackDeployerInfra extends Construct {
  public readonly worker: StackDeployerWorkerLambda;
  public readonly starter: StackDeployerStarterLambda;
  public readonly workflow: MailboxStackDeployerWorkflow;

  constructor(scope: Construct, id: string, props: StackDeployerInfraProps) {
    super(scope, id);

    // Worker Lambda: performs CloudFormation operations and polls for completion.
    this.worker = new StackDeployerWorkerLambda(this, 'worker', {
      artifactResolver: props.artifactResolver,
    });

    // Step Functions state machine name, derived from the stack GUID for uniqueness.
    // StackId is an ARN: arn:aws:cloudformation:region:acct:stack/stack-name/guid
    const stackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
    const stateMachineName = Fn.join('', [props.stateMachineNamePrefix, stackGuid]);

    this.workflow = new MailboxStackDeployerWorkflow(this, 'workflow', {
      handler: this.worker,
      checkInterval: Duration.seconds(20),
      timeout: Duration.minutes(90),
      stateMachineName,
    });

    // Starter Lambda: CFN custom resource entrypoint — only starts the Step Functions execution.
    this.starter = new StackDeployerStarterLambda(this, 'starter', {
      artifactResolver: props.artifactResolver,
      stateMachineArn: this.workflow.stateMachine.stateMachineArn,
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
