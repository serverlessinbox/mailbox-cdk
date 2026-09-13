import { wrapHandler } from 'aws-custom-resources';
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import { withSmokeTest, emitManualFinalize, env, LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { SFNClient, StartExecutionCommand, ListExecutionsCommand, StopExecutionCommand } from '@aws-sdk/client-sfn';
import { sweepCert } from './targets/cert';
import { sweepEdgeFn } from './targets/edge-fn';
import { sweepStackFailureDetector } from './targets/stack-failure-detector';
import type { CertRemovalInput, EdgeFunctionRemovalInput, StackFailureDetectorRemovalInput, TargetResult } from './targets/types';

export type { CertRemovalInput, EdgeFunctionRemovalInput, StackFailureDetectorRemovalInput } from './targets/types';

const sfnClient = new SFNClient({ region: process.env.AWS_REGION });

/**
 * Discriminated per-removal-type payload the worker Lambda dispatches on. Each removal's CDK
 * implementation (`features/sweeper/*-removal.ts`) bakes its own `removalType` + target fields into
 * the state machine definition at synth time — this worker never receives a mixed bag of optional
 * fields, only exactly the fields the matching sub-handler needs.
 */
export type WorkerInput =
  | ({ removalType: 'cert' } & CertRemovalInput)
  | ({ removalType: 'edge-fn' } & EdgeFunctionRemovalInput)
  | ({ removalType: 'detector' } & StackFailureDetectorRemovalInput);

/**
 * Worker handler output: status of the sweep operation.
 * - SUCCESS: the target is confirmed gone.
 * - RETRY: the target is not yet deletable.
 * - FAILED: hard error or ownership mismatch.
 */
export interface WorkerOutput {
  status: 'SUCCESS' | 'RETRY' | 'FAILED';
  reason?: string;
}

function toWorkerOutput(result: TargetResult): WorkerOutput {
  if (result.status === 'done') return { status: 'SUCCESS' };
  if (result.status === 'retry') return { status: 'RETRY', reason: result.reason };
  return { status: 'FAILED', reason: result.reason };
}

/**
 * The custom resource's `ResourceProperties`/`OldResourceProperties` shape: one opaque entry per
 * registered removal, keyed by that removal's `IResourceRemoval.id` (see
 * `features/sweeper/deferred-removal.ts`). This starter never interprets a removal's own fields — it
 * only diffs each entry structurally and forwards whichever ones changed, opaque, as the sweep
 * targets for that removal. `ServiceToken`/`ServiceTimeout` are CFN's own injected keys, never a
 * removal id, and are stripped before diffing.
 */
export type RemovalPropertiesMap = Record<string, unknown>;

const RESERVED_RESOURCE_PROPERTY_KEYS = new Set(['ServiceToken', 'ServiceTimeout']);

function stripReservedKeys(props: RemovalPropertiesMap): RemovalPropertiesMap {
  const result: RemovalPropertiesMap = {};
  for (const [key, value] of Object.entries(props)) {
    if (!RESERVED_RESOURCE_PROPERTY_KEYS.has(key)) result[key] = value;
  }
  return result;
}

/**
 * BWCOMPAT(2026-09-08): before this rework, the custom resource carried a flat `CertArn`/`EdgeFnArn`
 * shape instead of today's per-removal-type keyed map (see git history of
 * `features/sweeper/deferred-removal.ts` prior to this change). A stack's first update after this
 * ships hands the starter `OldResourceProperties` in that old flat shape — normalise it into the
 * keyed form (under the `cert`/`edge-fn` removal ids) so the diff below can treat every update the
 * same way, old or new. The stack-failure detector never had a deployed flat shape (it did not
 * exist before this rework), so it needs no fallback here — only `cert`/`edge-fn` do.
 * Remove when: every live stack has had a template update on/after 2026-09-08.
 */
function normalizeOldProperties(old: RemovalPropertiesMap | undefined): RemovalPropertiesMap {
  if (!old) return {};
  const normalized = stripReservedKeys(old);
  if (typeof old['CertArn'] === 'string') {
    normalized['cert'] = { certArn: old['CertArn'] };
    delete normalized['CertArn'];
  }
  if (typeof old['EdgeFnArn'] === 'string') {
    normalized['edge-fn'] = { edgeFnArn: old['EdgeFnArn'] };
    delete normalized['EdgeFnArn'];
  }
  return normalized;
}

/** Structural equality over plain JSON-shaped values — used to detect whether a removal's own entry
 * actually changed between old and new properties, without this starter knowing any of its fields. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => deepEqual(value, b[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  return aKeys.length === bKeys.length && aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
}

/**
 * Decides what this invocation needs to sweep, per registered removal:
 * - Delete: every removal present in `ResourceProperties` (the last-known targets).
 * - Update: for each removal present in the (BWCOMPAT-normalised) old properties, sweep its OLD
 *   value when that removal is now absent or its entry changed — e.g. a domain change replacing a
 *   cert or edge function. An unchanged removal contributes nothing.
 * - Create: nothing exists yet to sweep.
 *
 * Exported for direct unit testing — the diff itself is the behaviour that regressed when this
 * custom resource stopped carrying properties at all, and is worth testing without going through a
 * mocked SFN client.
 */
export function computeSweepTargets(event: CloudFormationCustomResourceEvent): RemovalPropertiesMap {
  const currentProps = stripReservedKeys(event.ResourceProperties as RemovalPropertiesMap);

  if (event.RequestType === 'Delete') {
    return currentProps;
  }

  if (event.RequestType === 'Create') {
    return {};
  }

  const oldProps = normalizeOldProperties(event.OldResourceProperties as RemovalPropertiesMap | undefined);
  const toSweep: RemovalPropertiesMap = {};
  for (const [removalId, oldValue] of Object.entries(oldProps)) {
    const newValue = currentProps[removalId];
    if (newValue === undefined || !deepEqual(oldValue, newValue)) {
      toSweep[removalId] = oldValue;
    }
  }
  return toSweep;
}

/**
 * Worker handler: invoked by Step Functions once per removal, with that removal's own typed
 * payload. Idempotent — each invocation re-checks and deletes whatever is still pending.
 *
 * Dispatches on `removalType` to the matching sub-handler in `./targets/*` — one sub-handler per
 * removal type, each taking only its own input shape.
 */
export const workerHandler = withSmokeTest(async (input: WorkerInput): Promise<WorkerOutput> => {
  // BWCOMPAT(2026-09-01): SERVICE_NAME read as optional — no already-deployed template sets it.
  // Remove when: every live stack has had a Path 2 template update on/after 2026-09-01.
  const service = env.get('SERVICE_NAME', undefined);
  const logger = new LoggerBuffer(service);

  logger.debug('Worker invoked', { removalType: input.removalType, rootStackName: input.rootStackName });

  let result: TargetResult;
  switch (input.removalType) {
    case 'cert':
      result = await sweepCert(input, logger);
      break;
    case 'edge-fn':
      result = await sweepEdgeFn(input, logger);
      break;
    case 'detector':
      result = await sweepStackFailureDetector(input, logger);
      break;
  }

  if (result.status === 'done') {
    logger.recordUpdate();
    logger.info('Worker completed successfully', { target: result.target });
  } else if (result.status === 'retry') {
    logger.info('Worker needs retry', { target: result.target, reason: result.reason });
  } else {
    logger.error('Worker failed', { target: result.target, reason: result.reason });
  }

  logger.flush();
  return toWorkerOutput(result);
});

/**
 * Starter handler: fires a single Step Functions execution to sweep whatever `computeSweepTargets`
 * decides needs sweeping for this request — every registered removal on Delete, or just the
 * removals whose entry changed/disappeared on Update (e.g. a domain change replacing a cert or edge
 * function). Called by CloudFormation custom resource (DeferredRemoval).
 *
 * Each removal's own target data lives in the custom resource's `ResourceProperties`, one opaque
 * entry per removal keyed by its `id` (see `features/sweeper/deferred-removal.ts`); this starter
 * never interprets those fields, it only diffs entries structurally and forwards whichever ones
 * changed as `{ toSweep: { ... } }` in the execution input. Each removal's own state-machine chain
 * (see `features/sweeper/removal.ts`) reads its target back out of that input at
 * `$.toSweep.<removalId>`, and skips itself entirely when nothing is present there.
 *
 * Wrapped with wrapHandler to guarantee CloudFormation response always sent; the sweep runs
 * asynchronously. StartExecution failures are logged but do not prevent the custom resource from
 * completing (best-effort).
 */
export const starterHandler = withSmokeTest(wrapHandler(async (event) => {
  // BWCOMPAT(2026-09-01): SERVICE_NAME read as optional — no already-deployed template sets it.
  // Remove when: every live stack has had a Path 2 template update on/after 2026-09-01.
  const service = env.get('SERVICE_NAME', undefined);
  const logger = new LoggerBuffer(service);

  // Emit finalization details for manual recovery of hung custom resources
  emitManualFinalize(event, { service });

  // Emit single always-emit diagnostic marker for this trigger mode
  console.info('resource-sweeper-starter dispatch', {
    requestType: event.RequestType,
    requestId: event.RequestId,
    logicalResourceId: event.LogicalResourceId,
  });

  logger.debug('Starter invoked', {
    requestType: event.RequestType,
    logicalResourceId: event.LogicalResourceId,
  });

  const smArn = process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN']!;

  // cast: wrapHandler's own event type (`TypeSafeCloudFormationResourceEvent`, from
  // `aws-custom-resources`) is `Omit<CloudFormationCustomResourceEvent, 'ResponseURL'>` — but `Omit`
  // over a union collapses it to ONE flat object keyed only by properties common to every request
  // type, which drops `OldResourceProperties` entirely (it isn't a key on the Create/Delete
  // variants), even though the real event, exactly as wrapHandler received and forwards it, always
  // carries it on Update. Re-assert the real, still-discriminated union type here instead of
  // reaching for `any` — `computeSweepTargets` still gets full narrowing on `RequestType`.
  const cfnEvent = event as CloudFormationCustomResourceEvent;
  const toSweep = computeSweepTargets(cfnEvent);
  const sweepTargetIds = Object.keys(toSweep);

  if (sweepTargetIds.length > 0) {
    try {
      // Reap any execution left RUNNING by a prior trigger before starting a fresh one — caps how
      // long a stale execution (e.g. one left by a deploy that predates the self-cleanup guard) can
      // outlive the deploy that started it.
      const running = await sfnClient.send(
        new ListExecutionsCommand({ stateMachineArn: smArn, statusFilter: 'RUNNING' }),
      );
      for (const execution of running.executions ?? []) {
        if (!execution.executionArn) continue;
        await sfnClient.send(new StopExecutionCommand({ executionArn: execution.executionArn }));
      }
      if (running.executions?.length) {
        logger.info('Stopped stale RUNNING execution(s) before starting', {
          count: running.executions.length,
        });
      }

      logger.info('Starting SFN execution', { executionName: event.RequestId, sweepTargetIds });

      await sfnClient.send(
        new StartExecutionCommand({
          stateMachineArn: smArn,
          name: event.RequestId,
          input: JSON.stringify({ toSweep }),
        }),
      );

      logger.recordUpdate();
      logger.info('SFN execution started successfully');
    } catch (err: any) {
      // ExecutionAlreadyExists means the execution is already running (likely a retry)
      if (err.name === 'ExecutionAlreadyExists') {
        logger.info('Execution already exists (likely a retry); treating as success');
        logger.recordUpdate();
      } else {
        // Any other error: log but do NOT throw. Delete must always succeed so
        // CloudFormation never hangs waiting for a response.
        // error() (not warn()) so LoggerBuffer.errorCount forces a flush — a warn-level report of a
        // real StartExecution failure (e.g. StateMachineDeleting) was silently discarded before.
        // Still non-throwing: best-effort side work must never block the CFN response.
        logger.error('Failed to start SFN execution (best-effort, will not propagate)', {
          errorName: err?.name,
          errorMessage: err?.message,
        });
      }
    }
  } else {
    logger.debug('No sweep targets for this request; nothing to trigger', {
      requestType: event.RequestType,
    });
  }

  // Flush if there's anything to report
  if (logger.shouldFlush()) {
    logger.flush();
  }

  // Return response object. wrapHandler will always send this to CloudFormation,
  // even if the function threw an uncaught error (which we don't have here).
  return {
    PhysicalResourceId: 'mailbox-deferred-removal',
    Data: {},
  };
}));
