import * as iam                                        from 'aws-cdk-lib/aws-iam';
import { IFunction }                                   from 'aws-cdk-lib/aws-lambda';
import * as tasks                                      from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sfn                                        from 'aws-cdk-lib/aws-stepfunctions';
import { Duration }                                    from 'aws-cdk-lib';
import { Construct }                                   from 'constructs';

import type { RemovalId, RemovalTargets, WorkerInput } from '../../runtime/resource-sweeper/removal';

/**
 * Contract for registering a resource type with the sweeper. An implementation owns its own target
 * data, the IAM grants its own resources need on the shared worker role, its own entry in the custom
 * resource's `ResourceProperties` map, and its own state-machine steps, including any waiting before
 * its target is deletable. There is no registry, no discovery and no base class.
 *
 * A removal's chain never bakes its target in as a literal: on Update the resource that needs
 * sweeping is the OLD one, which isn't in the newly synthesized definition. It reads its target at
 * runtime from `$.toSweep.<id>` in the execution input (see `withTargetPresenceGuard` below), and
 * skips itself when nothing is there.
 */
export interface IResourceRemoval<TId extends RemovalId = RemovalId> {
  /**
   * Unique id for this removal. Used to keep its Step Functions state names collision-free, as the
   * key under which this removal's own `crProperties()` entry is placed in the custom resource's
   * `ResourceProperties` map, and as the key under which its runtime target is looked up in the
   * execution input (`$.toSweep.<id>`).
   */
  readonly id: TId;

  /** IAM statements this removal needs granted on the shared worker role, for its own resources only. */
  grantStatements(): iam.PolicyStatement[];

  /**
   * This removal's own entry for the custom resource's `ResourceProperties` map, keyed by this
   * removal's `id`.
   */
  crProperties(): RemovalTargets[TId];

  /**
   * Builds this removal's own state-machine chain: a presence check on `$.toSweep.<id>` (see
   * `withTargetPresenceGuard`), then — only when present — whatever waiting it needs, then invoking
   * `worker` with a payload read from that same execution-input path, retrying on RETRY every
   * `retryInterval` until the worker reports SUCCESS (continuing to `onSuccess`) or FAILED (a
   * terminal Fail state). When nothing is present at `$.toSweep.<id>`, skips straight to `onSuccess`.
   * Returns the chain's entry state.
   */
  buildChain(worker: IFunction, retryInterval: Duration, onSuccess: sfn.IChainable): sfn.State;
}

/** The worker invocation of one removal and the loop that repeats it until the worker is done. */
export interface WorkerRetryLoopProps {
  readonly worker: IFunction;
  /** The worker payload; its string fields are state-machine references to the execution input. */
  readonly payload: WorkerInput;
  readonly retryInterval: Duration;
  /** Where the loop continues when the worker reports SUCCESS. */
  readonly onSuccess: sfn.IChainable;
  /** The cause the terminal Fail state reports when the worker reports anything but SUCCESS or RETRY. */
  readonly failureCause: string;
  /** Waited once before the first invocation, not between retries. */
  readonly gracePeriod?: Duration;
}

/**
 * A state-machine reference to one field of a removal's target in the execution input. The field
 * names are those of the removal's own target type, so a rename there breaks the compile here.
 */
export function targetField<TId extends RemovalId>(removalId: TId, field: keyof RemovalTargets[TId] & string): string {
  return sfn.JsonPath.stringAt(`$.toSweep.${removalId}.${field}`);
}

/**
 * Wraps `entry` (a removal's own wait/invoke chain) in a Choice that only enters it when
 * `$.toSweep.<id>` is present in the execution input, otherwise skipping straight to `onSuccess`.
 */
export function withTargetPresenceGuard(
  scope: Construct,
  id: string,
  removalId: RemovalId,
  entry: sfn.IChainable,
  onSuccess: sfn.IChainable,
): sfn.State {
  return new sfn.Choice(scope, id)
    .when(sfn.Condition.isPresent(`$.toSweep.${removalId}`), entry)
    .otherwise(onSuccess);
}

/**
 * Invokes the worker, waits `retryInterval` and invokes it again while it reports RETRY, continues to
 * `onSuccess` on SUCCESS and fails on anything else. Its states are named `<idPrefix>Invoke`,
 * `<idPrefix>WaitRetry`, `<idPrefix>StatusChoice` and `<idPrefix>Failed`, plus `<idPrefix>GraceWait`
 * when a grace period is given. Returns the loop's entry: the grace wait, else the invoke state.
 */
export function buildWorkerRetryLoop(scope: Construct, idPrefix: string, props: WorkerRetryLoopProps): sfn.State {
  const graceWait = props.gracePeriod === undefined
    ? undefined
    : new sfn.Wait(scope, `${idPrefix}GraceWait`, { time: sfn.WaitTime.duration(props.gracePeriod) });

  const invoke = new tasks.LambdaInvoke(scope, `${idPrefix}Invoke`, {
    lambdaFunction: props.worker,
    payloadResponseOnly: true,
    resultPath: '$.workerResult',
    payload: sfn.TaskInput.fromObject({ ...props.payload }),
    retryOnServiceExceptions: true,
  });

  const wait = new sfn.Wait(scope, `${idPrefix}WaitRetry`, { time: sfn.WaitTime.duration(props.retryInterval) });

  const choice = new sfn.Choice(scope, `${idPrefix}StatusChoice`)
    .when(sfn.Condition.stringEquals('$.workerResult.status', 'SUCCESS'), props.onSuccess)
    .when(sfn.Condition.stringEquals('$.workerResult.status', 'RETRY'), wait)
    .otherwise(new sfn.Fail(scope, `${idPrefix}Failed`, { error: 'WorkerFailed', cause: props.failureCause }));

  graceWait?.next(invoke);
  invoke.next(choice);
  wait.next(invoke);

  return graceWait ?? invoke;
}
