import { Aws, Duration, Fn } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { TypeScriptLambda } from './ts-lambda';
import type { ICdkArtifactResolver } from '../artifacts/cdk-artifact-resolver';
import { MailboxStackDeployerWorkflow } from './stack-deployer-workflow';

export interface StackDeployerInfraProps {
  readonly artifactResolver: ICdkArtifactResolver;
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
  public readonly worker: TypeScriptLambda;
  public readonly starter: TypeScriptLambda;
  public readonly workflow: MailboxStackDeployerWorkflow;

  constructor(scope: Construct, id: string, props: StackDeployerInfraProps) {
    super(scope, id);

    // Worker Lambda: performs CloudFormation operations and polls for completion.
    this.worker = new TypeScriptLambda(this, 'worker', {
      lambdaId: 'stack-deployer',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      handler: 'index.workerHandler',
      timeout: Duration.minutes(15),
      memorySize: 512,
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
    this.starter = new TypeScriptLambda(this, 'starter', {
      lambdaId: 'stack-deployer',
      artifactResolver: props.artifactResolver,
      packageName: 'mailbox-cdk',
      handler: 'index.starterHandler',
      timeout: Duration.minutes(1),
      memorySize: 256,
    });

    this.starter.addEnvironment(
      'MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN',
      this.workflow.stateMachine.stateMachineArn,
    );

    this.starter.addToRolePolicy(
      new PolicyStatement({
        actions: ['states:StartExecution'],
        resources: [this.workflow.stateMachine.stateMachineArn],
      }),
    );
  }
}
