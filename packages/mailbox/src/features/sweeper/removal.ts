import * as iam from 'aws-cdk-lib/aws-iam';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { RemovalId, RemovalTargets } from '../../ts-lambdas/resource-sweeper/removal';

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

/**
 * Shared helper: a state-machine reference to one field of a removal's target in the execution
 * input. The field names are those of the removal's own target type, so a rename there breaks the
 * compile here.
 */
export function targetField<TId extends RemovalId>(removalId: TId, field: keyof RemovalTargets[TId] & string): string {
  return sfn.JsonPath.stringAt(`$.toSweep.${removalId}.${field}`);
}

/**
 * Shared helper: wraps `entry` (this removal's own wait/invoke chain) in a Choice that only enters it
 * when `$.toSweep.<id>` is present in the execution input, otherwise skipping straight to `onSuccess`.
 * A plain function, not a base class — every removal calls this from its own `buildChain` but owns the
 * rest of its chain (and its own field names under `$.toSweep.<id>`) independently.
 */
export function withTargetPresenceGuard(
  scope: Construct,
  id: string,
  removalId: string,
  entry: sfn.IChainable,
  onSuccess: sfn.IChainable,
): sfn.State {
  return new sfn.Choice(scope, id)
    .when(sfn.Condition.isPresent(`$.toSweep.${removalId}`), entry)
    .otherwise(onSuccess);
}
