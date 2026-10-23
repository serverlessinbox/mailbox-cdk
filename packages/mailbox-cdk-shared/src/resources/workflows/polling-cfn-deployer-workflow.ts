import { IGrantable }                          from 'aws-cdk-lib/aws-iam';
import { IFunction }                           from 'aws-cdk-lib/aws-lambda';
import * as tasks                              from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sfn                                from 'aws-cdk-lib/aws-stepfunctions';
import { Duration }                            from 'aws-cdk-lib';
import type { IResolvable }                    from 'aws-cdk-lib';
import { Construct }                           from 'constructs';

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
  /** The state machine's explicit physical name. */
  readonly stateMachineName: string;
}

/** The invocation payload of every polling worker call: an `SfnInvokeEvent` whose references into the state the state machine resolves when it runs. */
interface CheckPayload extends RetryCounts {
  readonly mode:    NonNullable<SfnInvokeEvent['mode']>;
  readonly cfn:     IResolvable;
  readonly op:      IResolvable;
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
 *
 * A state machine is built from its states, so they exist before the state machine does; they are
 * created under a construct of their own, `<id>-states`, beside it.
 */
export class PollingCfnDeployerWorkflow extends sfn.StateMachine implements IPollingCfnDeployerWorkflow {
  constructor(scope: Construct, id: string, props: PollingCfnDeployerWorkflowProps) {
    super(scope, id, {
      definitionBody:   sfn.DefinitionBody.fromChainable(
        PollingCfnDeployerWorkflow.definition(new Construct(scope, `${id}-states`), props),
      ),
      timeout:          props.timeout ?? Duration.minutes(90),
      comment:          'Serverless Inbox: sub-stack deployer workflow',
      stateMachineName: props.stateMachineName,
    });
  }

  public grantStartAndDescribeExecutions(grantee: IGrantable): void {
    this.grantStartExecution(grantee);
    this.grantExecution(grantee, 'states:DescribeExecution');
  }

  private static definition(states: Construct, props: PollingCfnDeployerWorkflowProps): sfn.IChainable {
    const waitBeforeCheck = PollingCfnDeployerWorkflow.waitBeforeCheck(states, props.checkInterval ?? Duration.seconds(20));
    const done            = PollingCfnDeployerWorkflow.done(states);

    return PollingCfnDeployerWorkflow.init(states)
      .next(PollingCfnDeployerWorkflow.startStackOperation(states, props.handler))
      // A start that already finalized the operation (an early failure) ends the workflow.
      .next(PollingCfnDeployerWorkflow.startedOk(states)
        .when(PollingCfnDeployerWorkflow.isDone(START_RESULT), done)
        .otherwise(waitBeforeCheck
          .next(PollingCfnDeployerWorkflow.checkStackOperation(states, props.handler))
          // The counters are read from a check that is still polling; a done result may carry none.
          .next(PollingCfnDeployerWorkflow.checkedDone(states)
            .when(PollingCfnDeployerWorkflow.isDone(CHECK_RESULT), done)
            .otherwise(PollingCfnDeployerWorkflow.incrementAttempt(states).next(waitBeforeCheck)))));
  }

  private static init(states: Construct): sfn.Pass {
    return new sfn.Pass(states, 'init', {
      parameters: {
        ...PollingCfnDeployerWorkflow.forward(CFN_FIELD),
        ...PollingCfnDeployerWorkflow.forward(OP_FIELD),
        [ATTEMPT_FIELD]:        0,
        [DELETE_RETRIES_FIELD]: 0,
        [CREATE_RETRIES_FIELD]: 0,
      },
    });
  }

  private static startStackOperation(states: Construct, handler: IFunction): tasks.LambdaInvoke {
    return PollingCfnDeployerWorkflow.workerInvocation(states, 'start-stack-operation', START_RESULT, PollingCfnDeployerWorkflow.startPayload(), handler);
  }

  private static startedOk(states: Construct): sfn.Choice {
    return new sfn.Choice(states, 'started-ok');
  }

  private static waitBeforeCheck(states: Construct, checkInterval: Duration): sfn.Wait {
    return new sfn.Wait(states, 'wait-before-check',{ time: sfn.WaitTime.duration(checkInterval) });
  }

  private static checkStackOperation(states: Construct, handler: IFunction): tasks.LambdaInvoke {
    return PollingCfnDeployerWorkflow.workerInvocation(states, 'check-stack-operation', CHECK_RESULT, PollingCfnDeployerWorkflow.checkPayload(), handler);
  }

  private static checkedDone(states: Construct): sfn.Choice {
    return new sfn.Choice(states, 'is-done');
  }

  private static done(states: Construct): sfn.Succeed {
    return new sfn.Succeed(states, 'done');
  }

  private static incrementAttempt(states: Construct): sfn.Pass {
    return new sfn.Pass(states, 'increment-attempt', {
      parameters: {
        ...PollingCfnDeployerWorkflow.forward(CFN_FIELD),
        ...PollingCfnDeployerWorkflow.forward(OP_FIELD),
        ...PollingCfnDeployerWorkflow.forward(START_RESULT),
        ...PollingCfnDeployerWorkflow.forward(CHECK_RESULT),
        [`${ATTEMPT_FIELD}.$`]:        `States.MathAdd(${PollingCfnDeployerWorkflow.path(ATTEMPT_FIELD)}, 1)`,
        [`${DELETE_RETRIES_FIELD}.$`]: PollingCfnDeployerWorkflow.path(CHECK_RESULT, DELETE_RETRIES_FIELD),
        [`${CREATE_RETRIES_FIELD}.$`]: PollingCfnDeployerWorkflow.path(CHECK_RESULT, CREATE_RETRIES_FIELD),
      },
    });
  }

  private static workerInvocation(states: Construct, id: string, resultField: ResultField, payload: StartPayload | CheckPayload, handler: IFunction): tasks.LambdaInvoke {
    return new tasks.LambdaInvoke(states, id, {
      lambdaFunction:      handler,
      payloadResponseOnly: true,
      resultPath:          PollingCfnDeployerWorkflow.path(resultField),
      payload:             sfn.TaskInput.fromObject(payload),
    });
  }

  private static startPayload(): StartPayload {
    return {
      mode:    'start',
      cfn:     sfn.JsonPath.objectAt(PollingCfnDeployerWorkflow.path(CFN_FIELD)),
      op:      sfn.JsonPath.objectAt(PollingCfnDeployerWorkflow.path(OP_FIELD)),
      attempt: sfn.JsonPath.numberAt(PollingCfnDeployerWorkflow.path(ATTEMPT_FIELD)),
    };
  }

  private static checkPayload(): CheckPayload {
    return {
      mode:             'check',
      cfn:              sfn.JsonPath.objectAt(PollingCfnDeployerWorkflow.path(CFN_FIELD)),
      op:               sfn.JsonPath.objectAt(PollingCfnDeployerWorkflow.path(OP_FIELD)),
      attempt:          sfn.JsonPath.numberAt(PollingCfnDeployerWorkflow.path(ATTEMPT_FIELD)),
      deleteRetryCount: sfn.JsonPath.numberAt(PollingCfnDeployerWorkflow.path(DELETE_RETRIES_FIELD)),
      createRetryCount: sfn.JsonPath.numberAt(PollingCfnDeployerWorkflow.path(CREATE_RETRIES_FIELD)),
    };
  }

  private static isDone(resultField: ResultField): sfn.Condition {
    return sfn.Condition.booleanEquals(PollingCfnDeployerWorkflow.path(resultField, DONE_FIELD), true);
  }

  private static forward(field: StateField): ForwardedField {
    return { [`${field}.$`]: PollingCfnDeployerWorkflow.path(field) };
  }

  private static path(...fields: PathField[]): string {
    return `$.${fields.join('.')}`;
  }
}
