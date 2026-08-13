import { Duration } from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface MailboxStackDeployerWorkflowProps {
  readonly handler: IFunction;
  /** How long to wait between checks (default: 20s). */
  readonly checkInterval?: Duration;
  /** Overall timeout for the workflow (default: 90m). */
  readonly timeout?: Duration;
  /** Optional explicit state machine name (helps avoid CFN circular deps when referenced elsewhere). */
  readonly stateMachineName?: string;
}

/**
 * CDK Construct wrapper for the stack deployer Step Functions workflow.
 *
 * Exposes the created `stateMachine` so other constructs can wire permissions/env vars
 * without having to think in terms of "loose" factory functions.
 */
export class MailboxStackDeployerWorkflow extends Construct {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: MailboxStackDeployerWorkflowProps) {
    super(scope, id);

    this.stateMachine = createMailboxStackDeployerStateMachine(this, 'StateMachine', props);
  }
}

/**
 * Creates the Step Functions workflow that drives the long-running stack deployment.
 *
 * Input shape:
 * {
 *   cfn: { ResponseURL, StackId, RequestId, LogicalResourceId, ... },
 *   op:  { requestType, stackName, templateUrl, parameters, terminationProtection }
 * }
 */
export function createMailboxStackDeployerStateMachine(
  scope: Construct,
  id: string,
  props: MailboxStackDeployerWorkflowProps
): sfn.StateMachine {
  const checkInterval = props.checkInterval ?? Duration.seconds(20);
  const timeout = props.timeout ?? Duration.minutes(90);

  // Track polling iterations so the worker can implement bounded retries.
  const init = new sfn.Pass(scope, 'Init', {
    parameters: {
      'cfn.$': '$.cfn',
      'op.$': '$.op',
      attempt: 0,
      deleteRetryCount: 0,
      createRetryCount: 0,
    },
  });

  const startOp = new tasks.LambdaInvoke(scope, 'StartStackOperation', {
    lambdaFunction: props.handler,
    payloadResponseOnly: true,
    resultPath: '$.start',
    payload: sfn.TaskInput.fromObject({
      mode: 'start',
      cfn: sfn.JsonPath.objectAt('$.cfn'),
      op: sfn.JsonPath.objectAt('$.op'),
      attempt: sfn.JsonPath.numberAt('$.attempt'),
    }),
  });

  const wait = new sfn.Wait(scope, 'WaitBeforeCheck', {
    time: sfn.WaitTime.duration(checkInterval),
  });

  const checkOp = new tasks.LambdaInvoke(scope, 'CheckStackOperation', {
    lambdaFunction: props.handler,
    payloadResponseOnly: true,
    resultPath: '$.check',
    payload: sfn.TaskInput.fromObject({
      mode: 'check',
      cfn: sfn.JsonPath.objectAt('$.cfn'),
      op: sfn.JsonPath.objectAt('$.op'),
      attempt: sfn.JsonPath.numberAt('$.attempt'),
      deleteRetryCount: sfn.JsonPath.numberAt('$.deleteRetryCount'),
      createRetryCount: sfn.JsonPath.numberAt('$.createRetryCount'),
    }),
  });

  const incrementAttempt = new sfn.Pass(scope, 'IncrementAttempt', {
    parameters: {
      'cfn.$': '$.cfn',
      'op.$': '$.op',
      'start.$': '$.start',
      'check.$': '$.check',
      'attempt.$': 'States.MathAdd($.attempt, 1)',
      'deleteRetryCount.$': '$.check.deleteRetryCount',
      'createRetryCount.$': '$.check.createRetryCount',
    },
  });

  const done = new sfn.Succeed(scope, 'Done');

  const checkChoice = new sfn.Choice(scope, 'IsDone?')
    .when(sfn.Condition.booleanEquals('$.check.done', true), done)
    .otherwise(wait);

  // Loop: Wait -> Check -> Choice (done? else Wait)
  wait.next(checkOp).next(incrementAttempt).next(checkChoice);

  const startChoice = new sfn.Choice(scope, 'StartedOk?')
    // If start already finalized (e.g. early failure), stop the workflow.
    .when(sfn.Condition.booleanEquals('$.start.done', true), done)
    .otherwise(wait);

  const definition = init.next(startOp).next(startChoice);

  return new sfn.StateMachine(scope, id, {
    definitionBody: sfn.DefinitionBody.fromChainable(definition),
    timeout,
    comment: 'Serverless Inbox Mailbox: stack deployer workflow',
    ...(props.stateMachineName ? { stateMachineName: props.stateMachineName } : {}),
  });
}
