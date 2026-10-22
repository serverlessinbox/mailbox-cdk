/** The ACM certificate to sweep, as the custom resource's `ResourceProperties` entry carries it. */
export interface CertRemovalTarget {
  readonly certArn: string;
}

/** The Lambda@Edge function to sweep, as the custom resource's `ResourceProperties` entry carries it. */
export interface EdgeFunctionRemovalTarget {
  readonly edgeFnArn: string;
}

/**
 * The stack-failure detector's rule, function and role, as the custom resource's
 * `ResourceProperties` entry carries them. They are swept together as one removal.
 */
export interface StackFailureDetectorRemovalTarget {
  readonly ruleArn:                string;
  readonly ruleTargetId:           string;
  readonly detectorFnArn:          string;
  readonly detectorRoleArn:        string;
  readonly detectorRolePolicyName: string;
}

/**
 * The `ResourceProperties` entry of each removal, keyed by the removal's id. The removal's id is
 * also the key of its target in the sweep's `toSweep` map.
 */
export interface RemovalTargets {
  readonly cert:      CertRemovalTarget;
  readonly 'edge-fn': EdgeFunctionRemovalTarget;
  readonly detector:  StackFailureDetectorRemovalTarget;
}

/** The id of a removal type. */
export type RemovalId = keyof RemovalTargets;

/** The root stack whose resources are swept, by the name tagged `root-stack` and the guid tagged `root-stack-id`. */
export interface RootStack {
  readonly rootStackName: string;
  readonly rootStackId:   string;
}

/** The ACM certificate to sweep, and the root stack it must belong to. */
export interface CertRemovalInput extends CertRemovalTarget, RootStack {}

/** The Lambda@Edge function to sweep, and the root stack it must belong to. */
export interface EdgeFunctionRemovalInput extends EdgeFunctionRemovalTarget, RootStack {}

/**
 * The stack-failure detector's rule, function and role, and the root stack they must belong to.
 * The grace period before they become deletable is a Wait step of the state machine, so a sweep of
 * this input assumes the grace period has already elapsed.
 */
export interface StackFailureDetectorRemovalInput extends StackFailureDetectorRemovalTarget, RootStack {}

/** The worker payload of a certificate removal. */
export interface CertWorkerInput extends CertRemovalInput {
  readonly removalType: 'cert';
}

/** The worker payload of a Lambda@Edge function removal. */
export interface EdgeFunctionWorkerInput extends EdgeFunctionRemovalInput {
  readonly removalType: 'edge-fn';
}

/** The worker payload of a stack-failure detector removal. */
export interface StackFailureDetectorWorkerInput extends StackFailureDetectorRemovalInput {
  readonly removalType: 'detector';
}

/**
 * Discriminated per-removal-type payload of the worker Lambda. A payload carries exactly the fields
 * of its own removal type, never a mixed bag of optional fields.
 */
export type WorkerInput = CertWorkerInput | EdgeFunctionWorkerInput | StackFailureDetectorWorkerInput;

/**
 * Outcome of one sweep as the worker Lambda reports it.
 * - SUCCESS: the target is confirmed gone.
 * - RETRY: the target is not yet deletable.
 * - FAILED: hard error or root stack mismatch.
 */
export interface WorkerOutput {
  status:  'SUCCESS' | 'RETRY' | 'FAILED';
  reason?: string;
}

/** Outcome of sweeping one removal target. */
export interface TargetResult {
  target:  string;
  status:  'done' | 'retry' | 'failed';
  reason?: string;
}

/** Sweeps one removal type: deletes its target when this stack owns it and it is deletable. */
export interface TargetSweeper<TInput> {
  /**
   * Sweeps the target `input` describes and resolves to the outcome; a failure of the target's own
   * AWS calls is an outcome (`retry` or `failed`), never a rejection. `done` means the target is gone,
   * `retry` means it is not deletable yet and the sweep should run again, `failed` means a retry
   * would not help.
   */
  sweep(input: TInput): Promise<TargetResult>;
}

/**
 * The custom resource's `ResourceProperties`/`OldResourceProperties`: one entry per registered
 * removal, keyed by the removal's id. An entry is opaque: it is forwarded whole, never read field
 * by field.
 */
export type RemovalPropertiesMap = Record<string, unknown>;
