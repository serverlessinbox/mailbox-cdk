import { Duration } from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/**
 * Fixed wait between recovery-loop checks. Not a prop: the loop's own bounds (attempt count,
 * iteration count, wall clock) are enforced entirely by the Lambda's check/recover modes — this
 * state machine carries no bounds logic of its own, per the plan.
 *
 * Go's own check-interval constant must equal this value.
 */
const CHECK_INTERVAL = Duration.seconds(30);

/**
 * Hard wall-clock cap on the whole execution, independent of Go's ~12h bound. Guarantees the
 * execution ends even if the Lambda errors on every single invocation (so the Retry/Catch loop
 * below never runs forever).
 */
const EXECUTION_TIMEOUT = Duration.hours(13);

/**
 * Retry policy applied to both `check` and `recover` task failures (on top of `LambdaInvoke`'s own
 * default retry for Lambda service exceptions, which is left untouched). Once exhausted, the Catch
 * below routes back to `wait` instead of failing the execution — see the class doc.
 */
const TASK_RETRY_MAX_ATTEMPTS = 3;
const TASK_RETRY_INTERVAL = Duration.seconds(5);
const TASK_RETRY_BACKOFF_RATE = 2;

export interface MailboxStackUpdateWorkflowProps {
  readonly handler: IFunction;

  /**
   * Explicit, deterministic state machine name.
   *
   * Required (no auto-name): the handler Lambda builds a copy of this state machine's ARN from
   * `Aws.*` tokens + this same name (see `StackUpdateApiLambda`) instead of taking a `Ref`/`GetAtt`
   * on this construct, which is what lets the Lambda be created before this state machine without
   * a CloudFormation circular dependency (this state machine's role only needs a `Ref`/`GetAtt`
   * dependency in the other direction, onto the already-created Lambda).
   */
  readonly stateMachineName: string;
}

/**
 * Step Functions workflow driving root-stack `UPDATE_ROLLBACK_FAILED` recovery
 * (`stack-update-resilience` plan, increment 2).
 *
 * Shape (Wait/Invoke/Choice loop, precedent: `stack-deployer-workflow.ts`):
 *
 * ```
 * Init(state) -> Wait -> Check(mode:check) -> Choice($.next)
 *   "wait"    -> Wait (loop back to Check)
 *   "recover" -> Recover(mode:recover) -> Choice($.next)
 *       "wait" -> Wait (loop back to Check)
 *       "fail" -> Fail
 *   "succeed" -> Succeed
 *   "fail"    -> Fail
 * ```
 *
 * Every `LambdaInvoke` uses `payloadResponseOnly: true` with the default `resultPath` ("$"), so
 * the Lambda's raw JSON response — `{ next, state }` — becomes the entire execution context for
 * the next task. This is how "carry `state` from each Lambda response into the next task" is
 * implemented: there is no separate bookkeeping state, the context after each invoke IS the
 * Lambda's own response.
 *
 * `check`/`recover` both carry a Retry (task failures, on top of `LambdaInvoke`'s own default
 * Lambda-service-exception retry) and a Catch-all routing back to `wait` with `resultPath:
 * '$.lastError'`. Go's `event-start` no-ops while an execution already exists for a failure
 * episode (running OR closed) — so an execution that closes early on a transient Lambda task
 * error would permanently block recovery for that episode. The loop must only close when Go
 * decides (`succeed`/`fail`) or the hard wall-clock `timeout` ends it; a Catch's default
 * `resultPath` behaviour (merge error info in, rather than replace `$`) is what keeps `$.state`
 * intact across the failure so the next `check` payload is still valid.
 */
export class MailboxStackUpdateWorkflow extends Construct {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: MailboxStackUpdateWorkflowProps) {
    super(scope, id);

    const init = new sfn.Pass(this, 'init', {
      parameters: {
        state: {
          'stackId.$': '$.stackId',
          'episodeToken.$': '$.episodeToken',
          'episodeStartedAt.$': '$.episodeStartedAt',
          'targetVersion.$': '$.targetVersion',
          attempt: 0,
          iterations: 0,
          fingerprint: '',
        },
      },
    });

    const wait = new sfn.Wait(this, 'wait', {
      time: sfn.WaitTime.duration(CHECK_INTERVAL),
    });

    const check = new tasks.LambdaInvoke(this, 'check', {
      lambdaFunction: props.handler,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({
        mode: 'check',
        state: sfn.JsonPath.objectAt('$.state'),
      }),
    });
    check.addRetry({
      errors: ['States.ALL'],
      maxAttempts: TASK_RETRY_MAX_ATTEMPTS,
      interval: TASK_RETRY_INTERVAL,
      backoffRate: TASK_RETRY_BACKOFF_RATE,
    });
    check.addCatch(wait, {
      errors: ['States.ALL'],
      resultPath: '$.lastError',
    });

    const recover = new tasks.LambdaInvoke(this, 'recover', {
      lambdaFunction: props.handler,
      payloadResponseOnly: true,
      payload: sfn.TaskInput.fromObject({
        mode: 'recover',
        state: sfn.JsonPath.objectAt('$.state'),
      }),
    });
    recover.addRetry({
      errors: ['States.ALL'],
      maxAttempts: TASK_RETRY_MAX_ATTEMPTS,
      interval: TASK_RETRY_INTERVAL,
      backoffRate: TASK_RETRY_BACKOFF_RATE,
    });
    recover.addCatch(wait, {
      errors: ['States.ALL'],
      resultPath: '$.lastError',
    });

    const succeed = new sfn.Succeed(this, 'succeed');
    const fail = new sfn.Fail(this, 'fail');

    // Unrecognised $.next is treated the same as "fail" (fail closed) rather than left to the
    // runtime's default States.NoChoiceMatched error — Go is the sole source of `next` values, so
    // this branch is a defensive default, not a bound the state machine is enforcing.
    const afterRecover = new sfn.Choice(this, 'choice-after-recover')
      .when(sfn.Condition.stringEquals('$.next', 'wait'), wait)
      .otherwise(fail);
    recover.next(afterRecover);

    const afterCheck = new sfn.Choice(this, 'choice-after-check')
      .when(sfn.Condition.stringEquals('$.next', 'wait'), wait)
      .when(sfn.Condition.stringEquals('$.next', 'recover'), recover)
      .when(sfn.Condition.stringEquals('$.next', 'succeed'), succeed)
      .otherwise(fail);
    check.next(afterCheck);

    wait.next(check);

    const definition = init.next(wait);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineName: props.stateMachineName,
      comment: 'Serverless Inbox Mailbox: stack update rollback recovery workflow',
      timeout: EXECUTION_TIMEOUT,
    });
  }
}
