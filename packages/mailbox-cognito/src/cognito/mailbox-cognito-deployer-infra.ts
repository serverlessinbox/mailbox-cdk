import { Aws, Duration, Fn } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as cdk from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { CognitoDeployerWorkerLambda, CognitoDeployerStarterLambda } from '../lambdas';

export interface MailboxCognitoDeployerInfraProps {
  /** Artifact resolver for deployer Lambda code (stack-deployer zip). Internal use; passed from parent. */
  readonly artifactResolver: ICdkArtifactEngine;
}

/**
 * Self-contained scaffolding for the Cognito data stack deployer.
 *
 * Creates:
 * - `worker` Lambda (15 min / 512 MB) — executes CloudFormation operations
 * - `workflow` Step Functions state machine (20s check interval, 90 min timeout)
 * - `starter` Lambda (1 min / 256 MB) — CloudFormation custom resource entrypoint
 *
 * Both worker and starter are served from the shared `mailbox-cdk` stack-deployer zip,
 * differentiated by handler entrypoint.
 *
 * Worker IAM policies for Cognito / CloudFormation resources are the caller's responsibility
 * (see MailboxCognitoDataDeployerGrants). The caller must also create the CustomResource and
 * call `resource.node.addDependency(deployerInfra.stateMachine)`.
 */
export class MailboxCognitoDeployerInfra extends Construct {
  public readonly worker: IFunction;
  public readonly starter: IFunction;
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: MailboxCognitoDeployerInfraProps) {
    super(scope, id);

    // Worker Lambda: performs CloudFormation operations and polls for completion.
    // Uses TypeScriptLambda wrapper to auto-apply artifact tags for auto-update tracking.
    this.worker = new CognitoDeployerWorkerLambda(this, 'worker', {
      artifactResolver: props.artifactResolver,
    });

    this._addLogRetention(this.worker, 'WorkerLogGroup');

    // Step Functions state machine name, derived from the stack GUID for uniqueness.
    // StackId is an ARN: arn:aws:cloudformation:region:acct:stack/stack-name/guid
    const stackGuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
    const stateMachineName = Fn.join('', ['mailbox-cognito-data-deployer-', stackGuid]);

    this.stateMachine = this._createStateMachine(this.worker, stateMachineName);

    // Starter Lambda: CFN custom resource entrypoint — only starts the Step Functions execution.
    // Uses TypeScriptLambda wrapper to auto-apply artifact tags for auto-update tracking.
    this.starter = new CognitoDeployerStarterLambda(this, 'starter', {
      artifactResolver: props.artifactResolver,
      stateMachineArn: this.stateMachine.stateMachineArn,
    });

    this._addLogRetention(this.starter, 'StarterLogGroup');

    this.starter.addToRolePolicy(
      new PolicyStatement({
        actions: ['states:StartExecution'],
        resources: [this.stateMachine.stateMachineArn],
      }),
    );
  }

  private _addLogRetention(fn: IFunction, logicalId: string): void {
    const cfnLogGroup = new logs.CfnLogGroup(this, logicalId, {
      logGroupName: `/aws/lambda/${fn.functionName}`,
      retentionInDays: RetentionDays.ONE_MONTH,
    });
    cfnLogGroup.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
  }

  /**
   * Inlines the Step Functions workflow that drives long-running CloudFormation operations.
   *
   * Input shape expected by the worker:
   * {
   *   cfn: { ResponseURL, StackId, RequestId, LogicalResourceId, ... },
   *   op:  { requestType, region, stackName, templateUrl, parameters, preserveOnDelete }
   * }
   */
  private _createStateMachine(handler: IFunction, stateMachineName: sfn.StateMachine['stateMachineName']): sfn.StateMachine {
    const checkInterval = Duration.seconds(20);
    const timeout = Duration.minutes(90);

    // Track polling iterations so the worker can implement bounded retries.
    const init = new sfn.Pass(this, 'Init', {
      parameters: {
        'cfn.$': '$.cfn',
        'op.$': '$.op',
        attempt: 0,
        deleteRetryCount: 0,
      },
    });

    const startOp = new tasks.LambdaInvoke(this, 'StartStackOperation', {
      lambdaFunction: handler,
      payloadResponseOnly: true,
      resultPath: '$.start',
      payload: sfn.TaskInput.fromObject({
        mode: 'start',
        cfn: sfn.JsonPath.objectAt('$.cfn'),
        op: sfn.JsonPath.objectAt('$.op'),
        attempt: sfn.JsonPath.numberAt('$.attempt'),
      }),
    });

    const wait = new sfn.Wait(this, 'WaitBeforeCheck', {
      time: sfn.WaitTime.duration(checkInterval),
    });

    const checkOp = new tasks.LambdaInvoke(this, 'CheckStackOperation', {
      lambdaFunction: handler,
      payloadResponseOnly: true,
      resultPath: '$.check',
      payload: sfn.TaskInput.fromObject({
        mode: 'check',
        cfn: sfn.JsonPath.objectAt('$.cfn'),
        op: sfn.JsonPath.objectAt('$.op'),
        attempt: sfn.JsonPath.numberAt('$.attempt'),
        deleteRetryCount: sfn.JsonPath.numberAt('$.deleteRetryCount'),
      }),
    });

    const incrementAttempt = new sfn.Pass(this, 'IncrementAttempt', {
      parameters: {
        'cfn.$': '$.cfn',
        'op.$': '$.op',
        'start.$': '$.start',
        'check.$': '$.check',
        'attempt.$': 'States.MathAdd($.attempt, 1)',
        'deleteRetryCount.$': '$.check.deleteRetryCount',
      },
    });

    const done = new sfn.Succeed(this, 'Done');

    const checkChoice = new sfn.Choice(this, 'IsDone?')
      .when(sfn.Condition.booleanEquals('$.check.done', true), done)
      .otherwise(wait);

    // Loop: Wait -> Check -> Choice (done? else Wait)
    wait.next(checkOp).next(incrementAttempt).next(checkChoice);

    const startChoice = new sfn.Choice(this, 'StartedOk?')
      // If start already finalized (e.g. early failure), stop the workflow.
      .when(sfn.Condition.booleanEquals('$.start.done', true), done)
      .otherwise(wait);

    const definition = init.next(startOp).next(startChoice);

    return new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout,
      comment: 'Serverless Inbox Mailbox Cognito: cognito data stack deployer workflow',
      stateMachineName,
    });
  }
}
