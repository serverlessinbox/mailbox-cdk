import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { LoggerBuffer } from './logger-buffer';

/**
 * Detects whether the parent CloudFormation stack is currently rolling back.
 *
 * During a rollback, CloudFormation sends custom-resource Update handlers the old properties
 * and expects SUCCESS responses. Answering FAILED during rollback leaves the stack in
 * UPDATE_ROLLBACK_FAILED, which is undeletable without manual intervention.
 *
 * This detector enables handlers to suppress errors and return SUCCESS when rolling back,
 * allowing the rollback to proceed cleanly.
 *
 * The client parameter is primarily for testing; at runtime a client is created automatically.
 * The logger parameter lets the calling handler capture this detector's trace in its own
 * buffered logger instead of writing unconditionally to the console.
 */
export async function isParentStackRollingBack(
  stackId: string,
  cfnClient?: CloudFormationClient,
  logger?: LoggerBuffer,
): Promise<boolean> {
  const status = await readParentStackStatus(stackId, cfnClient || new CloudFormationClient(), logger);
  return status === 'UPDATE_ROLLBACK_IN_PROGRESS';
}

/**
 * Detects whether the parent CloudFormation stack is being deleted (`DELETE_IN_PROGRESS`).
 *
 * A custom resource also receives Delete when it is merely replaced or removed from a stack that
 * stays alive; only a Delete during stack deletion means the whole stack is going away. When the
 * status cannot be read this reports false, so the caller skips destructive work: skipping leaves
 * orphans that can be reclaimed later, while acting wrongly destroys live resources.
 *
 * The client and logger parameters behave as in {@link isParentStackRollingBack}.
 */
export async function isParentStackBeingDeleted(
  stackId: string,
  cfnClient?: CloudFormationClient,
  logger?: LoggerBuffer,
): Promise<boolean> {
  const status = await readParentStackStatus(stackId, cfnClient || new CloudFormationClient(), logger);
  return status === 'DELETE_IN_PROGRESS';
}

/**
 * Reads the parent stack's status. Returns undefined when the stack is not returned or the lookup
 * fails (not found, permission denied, ...), so each caller treats an unknown status as "not in the
 * state I am looking for" and proceeds with its normal handling. The failure is logged at warn level
 * so it is visible in the trace if that gets flushed.
 */
async function readParentStackStatus(
  stackId: string,
  client: CloudFormationClient,
  logger?: LoggerBuffer,
): Promise<string | undefined> {
  try {
    const response = await client.send(
      new DescribeStacksCommand({ StackName: stackId }),
    );
    return response.Stacks?.[0]?.StackStatus;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.warn(`Failed to check parent stack status: ${message}`);
    return undefined;
  }
}
