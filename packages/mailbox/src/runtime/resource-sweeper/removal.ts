import * as t from 'typanion';

const isNonEmptyString = t.cascade(t.isString(), [t.hasMinLength(1)]);

const certTargetFields = {
  certArn: t.isString(),
};

const edgeFunctionTargetFields = {
  edgeFnArn: t.isString(),
};

const stackFailureDetectorRuleFields = {
  ruleArn:      t.isString(),
  ruleTargetId: isNonEmptyString,
};

const stackFailureDetectorFunctionFields = {
  detectorFnArn: t.isString(),
};

const stackFailureDetectorRoleFields = {
  detectorRoleArn:        t.isString(),
  detectorRolePolicyName: isNonEmptyString,
};

const stackFailureDetectorTargetFields = {
  ...stackFailureDetectorRuleFields,
  ...stackFailureDetectorFunctionFields,
  ...stackFailureDetectorRoleFields,
};

const sweeperRoleTargetFields = {
  workerRoleArn:        t.isString(),
  workerRolePolicyName: isNonEmptyString,
};

const workerRootStackFields = {
  rootStackName: t.isString(),
  rootStackId:   t.isString(),
};

const isCertRemovalTarget                 = t.isObject(certTargetFields);
const isEdgeFunctionRemovalTarget         = t.isObject(edgeFunctionTargetFields);
const isStackFailureDetectorRemovalTarget = t.isObject(stackFailureDetectorTargetFields);
const isWorkerRootStack                   = t.isObject(workerRootStackFields);
const isSweeperRoleRemovalTarget          = t.isObject(sweeperRoleTargetFields);

/** One entry of the custom resource's properties as the planner reads it: every removal's fields are strings. */
export const isRemovalEntry = t.isRecord(t.isString());

/** One entry of the custom resource's properties. */
export type RemovalEntry = t.InferType<typeof isRemovalEntry>;

/**
 * A part of a removal: the resource the sweep removes as one unit. The part is swept when its
 * `identity` field changed between the old and new properties; `fields` is everything the sweep of
 * the part needs.
 */
export interface RemovalPart<TTarget> extends RemovalPartFields {
  readonly identity: keyof TTarget & string;
  readonly fields:   ReadonlyArray<keyof TTarget & string>;
}

/** A removal part by its field names, for code that handles the parts of any removal. */
export interface RemovalPartFields {
  readonly identity: string;
  readonly fields:   readonly string[];
}

/**
 * The parts of each removal. A cert and an edge function are one resource each, identified by their
 * ARN. The detector is three resources: its rule, function and role.
 */
export const REMOVAL_PARTS: { readonly [TId in RemovalId]: ReadonlyArray<RemovalPart<RemovalTargets[TId]>> } = {
  'cert':         [{ identity: 'certArn', fields: ['certArn'] }],
  'edge-fn':      [{ identity: 'edgeFnArn', fields: ['edgeFnArn'] }],
  'detector':     [
    { identity: 'ruleArn', fields: ['ruleArn', 'ruleTargetId'] },
    { identity: 'detectorFnArn', fields: ['detectorFnArn'] },
    { identity: 'detectorRoleArn', fields: ['detectorRoleArn', 'detectorRolePolicyName'] },
  ],
  'sweeper-role': [{ identity: 'workerRoleArn', fields: ['workerRoleArn', 'workerRolePolicyName'] }],
};

/**
 * Whether a Delete sweeps a removal's target. A Delete plans the target of every removal present, except a removal
 * whose target the workflow's self-cleanup tail removes after the last removal: the sweeper's own worker role.
 */
export const SWEPT_ON_DELETE: { readonly [TId in RemovalId]: boolean } = {
  'cert':         true,
  'edge-fn':      true,
  'detector':     true,
  'sweeper-role': false,
};

const detectorSweepPartsFields = {
  ruleArn:                t.isOptional(stackFailureDetectorRuleFields.ruleArn),
  ruleTargetId:           t.isOptional(stackFailureDetectorRuleFields.ruleTargetId),
  detectorFnArn:          t.isOptional(stackFailureDetectorFunctionFields.detectorFnArn),
  detectorRoleArn:        t.isOptional(stackFailureDetectorRoleFields.detectorRoleArn),
  detectorRolePolicyName: t.isOptional(stackFailureDetectorRoleFields.detectorRolePolicyName),
};

/** Accepts a detector sweep whose parts are each whole (all of a part's fields or none) and of which at least one is present. */
const hasWholeDetectorParts = t.makeValidator<Record<string, string | undefined>>({
  test: (value, state) => {
    const present    = REMOVAL_PARTS.detector.map((part) => part.fields.map((field) => value[field] !== undefined));
    const wholeParts = present.every((flags) => flags.every(Boolean) || !flags.some(Boolean));
    if (!wholeParts) {
      state?.errors?.push(`${state.p ?? '.'}: each detector part (rule, function, role) must carry all of its fields or none`);
      return false;
    }
    if (!present.some((flags) => flags.some(Boolean))) {
      state?.errors?.push(`${state?.p ?? '.'}: at least one detector part (rule, function, role) must be present`);
      return false;
    }
    return true;
  },
});

const isStackFailureDetectorSweepParts = t.cascade(t.isObject(detectorSweepPartsFields), [hasWholeDetectorParts]);

const isCertWorkerInput                 = t.isPartial({ removalType: t.isLiteral('cert'), ...certTargetFields, ...workerRootStackFields });
const isEdgeFunctionWorkerInput         = t.isPartial({ removalType: t.isLiteral('edge-fn'), ...edgeFunctionTargetFields, ...workerRootStackFields });
const isStackFailureDetectorWorkerInput = t.isPartial({
  removalType: t.isLiteral('detector'),
  target:      isStackFailureDetectorSweepParts,
  ...workerRootStackFields,
});
const isSweeperRoleWorkerInput          = t.isPartial({ removalType: t.isLiteral('sweeper-role'), ...sweeperRoleTargetFields, ...workerRootStackFields });

/** The ACM certificate to sweep, as the custom resource's `ResourceProperties` entry carries it. */
export type CertRemovalTarget = t.InferType<typeof isCertRemovalTarget>;

/** The Lambda@Edge function to sweep, as the custom resource's `ResourceProperties` entry carries it. */
export type EdgeFunctionRemovalTarget = t.InferType<typeof isEdgeFunctionRemovalTarget>;

/**
 * The stack-failure detector's rule, function and role, as the custom resource's
 * `ResourceProperties` entry carries them. They are registered as one removal, and each is swept
 * separately, when its own identity changes.
 */
export type StackFailureDetectorRemovalTarget = t.InferType<typeof isStackFailureDetectorRemovalTarget>;

/** The sweeper's own worker IAM role, as the custom resource's `ResourceProperties` entry carries it. */
export type SweeperRoleRemovalTarget = t.InferType<typeof isSweeperRoleRemovalTarget>;

/**
 * The parts of the stack-failure detector the sweep removes: any of the rule (`ruleArn` with
 * `ruleTargetId`), the function (`detectorFnArn`) and the role (`detectorRoleArn` with
 * `detectorRolePolicyName`), at least one, each whole.
 */
export type StackFailureDetectorSweepParts = t.InferType<typeof isStackFailureDetectorSweepParts>;

/**
 * The `ResourceProperties` entry of each removal, keyed by the removal's id. The removal's id is
 * also the key of its target in the sweep's `toSweep` map.
 */
export interface RemovalTargets {
  readonly cert:           CertRemovalTarget;
  readonly 'edge-fn':      EdgeFunctionRemovalTarget;
  readonly detector:       StackFailureDetectorRemovalTarget;
  readonly 'sweeper-role': SweeperRoleRemovalTarget;
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
 * The parts of the stack-failure detector to sweep, and the root stack they must belong to.
 * The grace period before they become deletable is a Wait step of the state machine, so a sweep of
 * this input assumes the grace period has already elapsed.
 */
export type StackFailureDetectorRemovalInput = StackFailureDetectorSweepParts & WorkerRootStack;

/** The sweeper's own worker IAM role to sweep, and the root stack it must belong to. */
export type SweeperRoleRemovalInput = SweeperRoleRemovalTarget & WorkerRootStack;

/** The worker payload of a certificate removal. */
export type CertWorkerInput = t.InferType<typeof isCertWorkerInput>;

/** The worker payload of a Lambda@Edge function removal. */
export type EdgeFunctionWorkerInput = t.InferType<typeof isEdgeFunctionWorkerInput>;

/** The worker payload of a stack-failure detector removal: the parts to sweep sit in `target`. */
export type StackFailureDetectorWorkerInput = t.InferType<typeof isStackFailureDetectorWorkerInput>;

/** The worker payload of a sweeper worker role removal. */
export type SweeperRoleWorkerInput = t.InferType<typeof isSweeperRoleWorkerInput>;

/** Accepts a worker payload of one of the four removal types, and nothing else. */
export const isWorkerInput = t.isOneOf([
  isCertWorkerInput,
  isEdgeFunctionWorkerInput,
  isStackFailureDetectorWorkerInput,
  isSweeperRoleWorkerInput,
]);

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
 * The custom resource's `ResourceProperties`/`OldResourceProperties`, and the planner's result: one
 * entry per registered removal, keyed by the removal's id. A planned entry carries only the parts to
 * sweep.
 */
export type RemovalPropertiesMap = Record<string, unknown>;
