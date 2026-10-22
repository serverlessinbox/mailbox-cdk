import { Grant, IGrantable }                   from 'aws-cdk-lib/aws-iam';
import { IFunction }                           from 'aws-cdk-lib/aws-lambda';
import * as tasks                              from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sfn                                from 'aws-cdk-lib/aws-stepfunctions';
import { ArnFormat, Duration, Fn, Stack }      from 'aws-cdk-lib';
import type { IResolvable }                    from 'aws-cdk-lib';
import { Construct, IDependable }              from 'constructs';

import type { SfnInvokeEvent, WorkflowInput }  from '../../runtime/stack-deployer/stack/stack-deployment';
import type { RetryCounts, WorkerResult }      from '../../runtime/stack-deployer/worker-result';

/** A deployer workflow's state machine address, and the permission to start and follow its executions. */
export interface IPollingCfnDeployerWorkflow {
  readonly stateMachineArn: string;
  grantStartAndDescribeExecutions(grantee: IGrantable): void;
}

/** What `PollingCfnDeployerWorkflow` needs: the worker function it invokes and the state machine's name; the timings are optional. */
export interface PollingCfnDeployerWorkflowProps {
  readonly handler: IFunction;
  /** How long to wait between checks (default: 20s). */
  readonly checkInterval?: Duration;
  /** Overall timeout for the workflow (default: 90m). */
  readonly timeout?: Duration;
  /** The state machine's name; also the source of the execution ARN pattern granted to the starter. */
  readonly stateMachineName: string;
}

/** The invocation payload of every polling worker call: an `SfnInvokeEvent` whose references into the state the state machine resolves when it runs. */
interface CheckPayload extends RetryCounts {
  readonly mode: NonNullable<SfnInvokeEvent['mode']>;
  readonly cfn: IResolvable;
  readonly op: IResolvable;
  readonly attempt: number;
}

/** The invocation payload of the first worker call: the checks' payload without the retry counters. */
type StartPayload = Omit<CheckPayload, keyof RetryCounts>;

/** The answer a worker call leaves in the state: that of the start invocation, or that of the latest check invocation. */
type ResultField = typeof START_RESULT | typeof CHECK_RESULT;

/** A top-level field of the state the workflow carries: the forwarded input and the answers of the worker calls. */
type StateField = typeof CFN_FIELD | typeof OP_FIELD | ResultField;

/** A field a path into the state can name. */
type PathField = StateField | typeof ATTEMPT_FIELD | typeof DELETE_RETRIES_FIELD | typeof CREATE_RETRIES_FIELD | typeof DONE_FIELD;

/** The state-machine parameter that copies a state field to the same field of the next state. */
type ForwardedField = Partial<Record<`${StateField}.$`, string>>;

const CFN_FIELD            = 'cfn' satisfies keyof WorkflowInput;
const OP_FIELD             = 'op' satisfies keyof WorkflowInput;
const ATTEMPT_FIELD        = 'attempt' satisfies keyof CheckPayload;
const DELETE_RETRIES_FIELD = 'deleteRetryCount' satisfies keyof RetryCounts;
const CREATE_RETRIES_FIELD = 'createRetryCount' satisfies keyof RetryCounts;
const DONE_FIELD           = 'done' satisfies keyof WorkerResult;
const START_RESULT         = 'start';
const CHECK_RESULT         = 'check';

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

    const waitBeforeCheck = this.waitBeforeCheck(props.checkInterval ?? Duration.seconds(20));
    const done            = this.done();

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(
        this.init()
          .next(this.startStackOperation(props.handler))
          // A start that already finalized the operation (an early failure) ends the workflow.
          .next(this.startedOk()
            .when(this.isDone(START_RESULT), done)
            .otherwise(waitBeforeCheck
              .next(this.checkStackOperation(props.handler))
              // The counters are read from a check that is still polling; a done result may carry none.
              .next(this.checkedDone()
                .when(this.isDone(CHECK_RESULT), done)
                .otherwise(this.incrementAttempt().next(waitBeforeCheck))))),
      ),
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

  private init(): sfn.Pass {
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

  private startStackOperation(handler: IFunction): tasks.LambdaInvoke {
    return this.workerInvocation('StartStackOperation', START_RESULT, this.startPayload(), handler);
  }

  private startedOk(): sfn.Choice {
    return new sfn.Choice(this, 'StartedOk?');
  }

  private waitBeforeCheck(checkInterval: Duration): sfn.Wait {
    return new sfn.Wait(this, 'WaitBeforeCheck', { time: sfn.WaitTime.duration(checkInterval) });
  }

  private checkStackOperation(handler: IFunction): tasks.LambdaInvoke {
    return this.workerInvocation('CheckStackOperation', CHECK_RESULT, this.checkPayload(), handler);
  }

  private checkedDone(): sfn.Choice {
    return new sfn.Choice(this, 'IsDone?');
  }

  private done(): sfn.Succeed {
    return new sfn.Succeed(this, 'Done');
  }

  private incrementAttempt(): sfn.Pass {
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

  private workerInvocation(id: string, resultField: ResultField, payload: StartPayload | CheckPayload, handler: IFunction): tasks.LambdaInvoke {
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

  private isDone(resultField: ResultField): sfn.Condition {
    return sfn.Condition.booleanEquals(this.path(resultField, DONE_FIELD), true);
  }

  private forward(field: StateField): ForwardedField {
    return { [`${field}.$`]: this.path(field) };
  }

  private path(...fields: PathField[]): string {
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
