import { Grant, IGrantable }                  from 'aws-cdk-lib/aws-iam';
import { IFunction }                          from 'aws-cdk-lib/aws-lambda';
import * as tasks                             from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sfn                               from 'aws-cdk-lib/aws-stepfunctions';
import { ArnFormat, Duration, Fn, Stack }     from 'aws-cdk-lib';
import { Construct, IDependable }             from 'constructs';

import type { SfnInvokeEvent, WorkflowInput } from '../../ts-lambdas/stack-deployer/stack-deployment';
import type { RetryCounts, WorkerResult }     from '../../ts-lambdas/stack-deployer/worker-result';

const CFN_FIELD            = 'cfn' satisfies keyof WorkflowInput;
const OP_FIELD             = 'op' satisfies keyof WorkflowInput;
const ATTEMPT_FIELD        = 'attempt' satisfies keyof SfnInvokeEvent;
const DELETE_RETRIES_FIELD = 'deleteRetryCount' satisfies keyof RetryCounts;
const CREATE_RETRIES_FIELD = 'createRetryCount' satisfies keyof RetryCounts;
const DONE_FIELD           = 'done' satisfies keyof WorkerResult;

/** Where the workflow keeps the answer of the start invocation, and of the latest check invocation. */
const START_RESULT = 'start';
const CHECK_RESULT = 'check';

/** The invocation payload of the first worker call: the checks' payload without the retry counters. */
type StartPayload = Record<Exclude<keyof SfnInvokeEvent, keyof RetryCounts>, unknown>;

/** The invocation payload of every polling worker call. */
type CheckPayload = Record<keyof SfnInvokeEvent, unknown>;

/** A deployer workflow's state machine address, and the permission to start and follow its executions. */
export interface IPollingCfnDeployerWorkflow {
  readonly stateMachineArn: string;
  grantStartAndDescribeExecutions(grantee: IGrantable): void;
}

export interface PollingCfnDeployerWorkflowProps {
  readonly handler: IFunction;
  /** How long to wait between checks (default: 20s). */
  readonly checkInterval?: Duration;
  /** Overall timeout for the workflow (default: 90m). */
  readonly timeout?: Duration;
  /** The state machine's name; also the source of the execution ARN pattern granted to the starter. */
  readonly stateMachineName: string;
}

/**
 * The Step Functions workflow that drives one long-running sub-stack deployment: it starts the stack
 * operation through the worker Lambda, then polls the worker until the operation is over.
 * Its input is a `WorkflowInput`.
 */
export class PollingCfnDeployerWorkflow extends Construct implements IPollingCfnDeployerWorkflow {
  public readonly stateMachineArn: string;

  /** A resource that depends on this is deleted before the state machine is. */
  public readonly stateMachineDependable: IDependable;

  private readonly stateMachineName: string;

  constructor(scope: Construct, id: string, props: PollingCfnDeployerWorkflowProps) {
    super(scope, id);

    this.stateMachineName = props.stateMachineName;

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(this.buildDefinition(props)),
      timeout: props.timeout ?? Duration.minutes(90),
      comment: 'Serverless Inbox: sub-stack deployer workflow',
      stateMachineName: props.stateMachineName,
    });

    this.stateMachineArn        = stateMachine.stateMachineArn;
    this.stateMachineDependable = stateMachine;
  }

  public grantStartAndDescribeExecutions(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions: ['states:StartExecution'],
      resourceArns: [this.stateMachineArn],
    });
    Grant.addToPrincipal({
      grantee,
      actions: ['states:DescribeExecution'],
      resourceArns: [this.executionArnPattern()],
    });
  }

  private buildDefinition(props: PollingCfnDeployerWorkflowProps): sfn.IChainable {
    const init             = this.initialState();
    const startOp          = this.workerInvocation('StartStackOperation', START_RESULT, this.startPayload(), props.handler);
    const wait             = new sfn.Wait(this, 'WaitBeforeCheck', {
      time: sfn.WaitTime.duration(props.checkInterval ?? Duration.seconds(20)),
    });
    const checkOp          = this.workerInvocation('CheckStackOperation', CHECK_RESULT, this.checkPayload(), props.handler);
    const incrementAttempt = this.incrementAttemptState();
    const done             = new sfn.Succeed(this, 'Done');

    // The counters are read from a check that is still polling; a done result may carry none.
    const checkChoice = new sfn.Choice(this, 'IsDone?')
      .when(this.isDone(CHECK_RESULT), done)
      .otherwise(incrementAttempt);

    incrementAttempt.next(wait);
    wait.next(checkOp).next(checkChoice);

    // A start that already finalized the operation (an early failure) ends the workflow.
    const startChoice = new sfn.Choice(this, 'StartedOk?')
      .when(this.isDone(START_RESULT), done)
      .otherwise(wait);

    return init.next(startOp).next(startChoice);
  }

  private initialState(): sfn.Pass {
    return new sfn.Pass(this, 'Init', {
      parameters: {
        ...this.forward(CFN_FIELD),
        ...this.forward(OP_FIELD),
        [ATTEMPT_FIELD]: 0,
        [DELETE_RETRIES_FIELD]: 0,
        [CREATE_RETRIES_FIELD]: 0,
      },
    });
  }

  private incrementAttemptState(): sfn.Pass {
    return new sfn.Pass(this, 'IncrementAttempt', {
      parameters: {
        ...this.forward(CFN_FIELD),
        ...this.forward(OP_FIELD),
        ...this.forward(START_RESULT),
        ...this.forward(CHECK_RESULT),
        [`${ATTEMPT_FIELD}.$`]: `States.MathAdd(${this.path(ATTEMPT_FIELD)}, 1)`,
        [`${DELETE_RETRIES_FIELD}.$`]: this.path(CHECK_RESULT, DELETE_RETRIES_FIELD),
        [`${CREATE_RETRIES_FIELD}.$`]: this.path(CHECK_RESULT, CREATE_RETRIES_FIELD),
      },
    });
  }

  private workerInvocation(id: string, resultField: string, payload: StartPayload | CheckPayload, handler: IFunction): tasks.LambdaInvoke {
    return new tasks.LambdaInvoke(this, id, {
      lambdaFunction: handler,
      payloadResponseOnly: true,
      resultPath: this.path(resultField),
      payload: sfn.TaskInput.fromObject(payload),
    });
  }

  private startPayload(): StartPayload {
    return {
      mode: 'start',
      cfn: sfn.JsonPath.objectAt(this.path(CFN_FIELD)),
      op: sfn.JsonPath.objectAt(this.path(OP_FIELD)),
      attempt: sfn.JsonPath.numberAt(this.path(ATTEMPT_FIELD)),
    };
  }

  private checkPayload(): CheckPayload {
    return {
      mode: 'check',
      cfn: sfn.JsonPath.objectAt(this.path(CFN_FIELD)),
      op: sfn.JsonPath.objectAt(this.path(OP_FIELD)),
      attempt: sfn.JsonPath.numberAt(this.path(ATTEMPT_FIELD)),
      deleteRetryCount: sfn.JsonPath.numberAt(this.path(DELETE_RETRIES_FIELD)),
      createRetryCount: sfn.JsonPath.numberAt(this.path(CREATE_RETRIES_FIELD)),
    };
  }

  private isDone(resultField: string): sfn.Condition {
    return sfn.Condition.booleanEquals(this.path(resultField, DONE_FIELD), true);
  }

  private forward(field: string): Record<string, string> {
    return { [`${field}.$`]: this.path(field) };
  }

  private path(...fields: string[]): string {
    return `$.${fields.join('.')}`;
  }

  private executionArnPattern(): string {
    return Stack.of(this).formatArn({
      service: 'states',
      resource: 'execution',
      resourceName: Fn.join(':', [this.stateMachineName, '*']),
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
  }
}
