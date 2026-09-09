/**
 * Per-removal-type input contracts. One interface per removal type — each sub-handler in this
 * directory takes only its own type, never a shared bag of optional fields, so no sub-handler can be
 * invoked without its own target and none can see another's fields.
 */

export interface CertRemovalInput {
  readonly certArn: string;
  readonly rootStackName: string;
}

export interface EdgeFunctionRemovalInput {
  readonly edgeFnArn: string;
  readonly rootStackName: string;
}

/**
 * The stack-failure detector's rule, function and role are swept together as one removal —
 * see `features/sweeper/stack-failure-detector-removal.ts` for why they're grouped instead of
 * registered separately. The grace-period wait that used to live here as a `graceUntil` flag
 * threaded through the worker is now a Wait step the CDK removal contributes to the state machine
 * (see `StackFailureDetectorRemoval.buildChain`) — this sub-handler is never invoked before the
 * target is deletable.
 */
export interface StackFailureDetectorRemovalInput {
  readonly ruleArn: string;
  readonly ruleTargetId: string;
  readonly detectorFnArn: string;
  readonly detectorRoleArn: string;
  readonly detectorRolePolicyName: string;
  readonly rootStackName: string;
}

/** Per-removal-type sweep result. */
export interface TargetResult {
  target: string;
  status: 'done' | 'retry' | 'failed';
  reason?: string;
}
