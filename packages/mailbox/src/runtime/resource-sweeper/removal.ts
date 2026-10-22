import * as t from 'typanion';

const isNonEmptyString = t.cascade(t.isString(), [t.hasMinLength(1)]);

const certTargetFields = {
  certArn: t.isString(),
};

const edgeFunctionTargetFields = {
  edgeFnArn: t.isString(),
};

const stackFailureDetectorTargetFields = {
  ruleArn:                t.isString(),
  ruleTargetId:           isNonEmptyString,
  detectorFnArn:          t.isString(),
  detectorRoleArn:        t.isString(),
  detectorRolePolicyName: isNonEmptyString,
};

const workerRootStackFields = {
  rootStackName: t.isString(),
  rootStackId:   t.isString(),
};

const isCertRemovalTarget                 = t.isObject(certTargetFields);
const isEdgeFunctionRemovalTarget         = t.isObject(edgeFunctionTargetFields);
const isStackFailureDetectorRemovalTarget = t.isObject(stackFailureDetectorTargetFields);
const isWorkerRootStack                   = t.isObject(workerRootStackFields);

const isCertWorkerInput                 = t.isPartial({ removalType: t.isLiteral('cert'), ...certTargetFields, ...workerRootStackFields });
const isEdgeFunctionWorkerInput         = t.isPartial({ removalType: t.isLiteral('edge-fn'), ...edgeFunctionTargetFields, ...workerRootStackFields });
const isStackFailureDetectorWorkerInput = t.isPartial({
  removalType: t.isLiteral('detector'),
  ...stackFailureDetectorTargetFields,
  ...workerRootStackFields,
});

/** The ACM certificate to sweep, as the custom resource's `ResourceProperties` entry carries it. */
export type CertRemovalTarget = t.InferType<typeof isCertRemovalTarget>;

/** The Lambda@Edge function to sweep, as the custom resource's `ResourceProperties` entry carries it. */
export type EdgeFunctionRemovalTarget = t.InferType<typeof isEdgeFunctionRemovalTarget>;

/**
 * The stack-failure detector's rule, function and role, as the custom resource's
 * `ResourceProperties` entry carries them. They are swept together as one removal.
 */
export type StackFailureDetectorRemovalTarget = t.InferType<typeof isStackFailureDetectorRemovalTarget>;

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
export type WorkerRootStack = t.InferType<typeof isWorkerRootStack>;

/** The ACM certificate to sweep, and the root stack it must belong to. */
export type CertRemovalInput = CertRemovalTarget & WorkerRootStack;

/** The Lambda@Edge function to sweep, and the root stack it must belong to. */
export type EdgeFunctionRemovalInput = EdgeFunctionRemovalTarget & WorkerRootStack;

/**
 * The stack-failure detector's rule, function and role, and the root stack they must belong to.
 * The grace period before they become deletable is a Wait step of the state machine, so a sweep of
 * this input assumes the grace period has already elapsed.
 */
export type StackFailureDetectorRemovalInput = StackFailureDetectorRemovalTarget & WorkerRootStack;

/** The worker payload of a certificate removal. */
export type CertWorkerInput = t.InferType<typeof isCertWorkerInput>;

/** The worker payload of a Lambda@Edge function removal. */
export type EdgeFunctionWorkerInput = t.InferType<typeof isEdgeFunctionWorkerInput>;

/** The worker payload of a stack-failure detector removal. */
export type StackFailureDetectorWorkerInput = t.InferType<typeof isStackFailureDetectorWorkerInput>;

/** Accepts a worker payload of one of the three removal types, and nothing else. */
export const isWorkerInput = t.isOneOf([isCertWorkerInput, isEdgeFunctionWorkerInput, isStackFailureDetectorWorkerInput]);

/**
 * Discriminated per-removal-type payload of the worker Lambda. A payload carries exactly the fields
 * of its own removal type, never a mixed bag of optional fields.
 */
export type WorkerInput = t.InferType<typeof isWorkerInput>;

/**
 * How one sweep ended, as Step Functions branches on it.
 * - SUCCESS: the target is confirmed gone.
 * - RETRY: the target is not yet deletable.
 * - FAILED: hard error or root stack mismatch.
 */
export type SweepStatus = 'SUCCESS' | 'RETRY' | 'FAILED';

/** Outcome of one sweep as the worker Lambda reports it. */
export interface WorkerOutput {
  readonly status:  SweepStatus;
  readonly reason?: string;
}

/** Outcome of sweeping one removal target. */
export interface TargetResult {
  readonly target:  RemovalId;
  readonly status:  SweepStatus;
  readonly reason?: string;
}

/** Sweeps one removal type: deletes its target when this stack owns it and it is deletable. */
export interface TargetSweeper<TInput> {
  /**
   * Sweeps the target `input` describes and resolves to the outcome; a failure of the target's own
   * AWS calls is an outcome (`RETRY` or `FAILED`), never a rejection. `SUCCESS` means the target is gone,
   * `RETRY` means it is not deletable yet and the sweep should run again, `FAILED` means a retry
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
