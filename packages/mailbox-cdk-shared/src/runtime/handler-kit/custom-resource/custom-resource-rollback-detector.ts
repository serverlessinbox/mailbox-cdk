import {
  DescribeStacksCommand,
  type CloudFormationClient,
  type StackStatus,
} from '@aws-sdk/client-cloudformation';

import { CaughtError }       from '../errors/caught-error';
import type { LoggerBuffer } from '../logger-buffer';

import type { StackId }      from './custom-resource-identifiers';

/**
 * Detects whether the parent CloudFormation stack is currently rolling back.
 *
 * During a rollback, CloudFormation sends custom-resource Update handlers the old properties
 * and expects SUCCESS responses. Answering FAILED during rollback leaves the stack in
 * UPDATE_ROLLBACK_FAILED, which is undeletable without manual intervention.
 *
 * A status that cannot be read counts as not rolling back. The failure is logged at warn level on the given logger.
 */
export async function isParentStackRollingBack(
  stackId: StackId,
  cfnClient: CloudFormationClient,
  logger?: LoggerBuffer,
): Promise<boolean> {
  const status = await readParentStackStatus(stackId, cfnClient, logger);
  return status === 'UPDATE_ROLLBACK_IN_PROGRESS';
}

/**
 * Detects whether the parent CloudFormation stack is being deleted (`DELETE_IN_PROGRESS`).
 *
 * A custom resource also receives Delete when it is merely replaced or removed from a stack that
 * stays alive; only a Delete during stack deletion means the whole stack is going away. When the
 * status cannot be read this reports false, so the caller skips destructive work: skipping leaves
 * orphans that can be reclaimed later, while acting wrongly destroys live resources.
 */
export async function isParentStackBeingDeleted(
  stackId: StackId,
  cfnClient: CloudFormationClient,
  logger?: LoggerBuffer,
): Promise<boolean> {
  const status = await readParentStackStatus(stackId, cfnClient, logger);
  return status === 'DELETE_IN_PROGRESS';
}

/** The stack's status; undefined when the stack is not returned or the lookup fails (not found, access denied, ...). */
async function readParentStackStatus(
  stackId: StackId,
  cfnClient: CloudFormationClient,
  logger: LoggerBuffer | undefined,
): Promise<StackStatus | undefined> {
  try {
    const response = await cfnClient.send(new DescribeStacksCommand({ StackName: stackId }));
    return response.Stacks?.[0]?.StackStatus;
  } catch (failure) {
    return warnUnreadable(failure, logger);
  }
}

function warnUnreadable(failure: unknown, logger: LoggerBuffer | undefined): undefined {
  logger?.warn(`Failed to check parent stack status: ${new CaughtError(failure).message ?? String(failure)}`);
  return undefined;
}
