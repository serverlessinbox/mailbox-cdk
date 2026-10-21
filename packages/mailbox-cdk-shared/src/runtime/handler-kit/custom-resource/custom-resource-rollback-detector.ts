import {
  DescribeStacksCommand,
  type CloudFormationClient,
  type StackStatus,
} from '@aws-sdk/client-cloudformation';

import type { LoggerBuffer } from '../logger-buffer';
import { CaughtError }       from '../errors/caught-error';

import type { StackId }      from './custom-resource-identifiers';

/**
 * Reads the status of the stack a custom resource belongs to, because a custom resource must answer CloudFormation
 * differently while its stack rolls back or is deleted. A status that cannot be read is reported as undefined, so
 * each question treats it as "not in the state I am looking for" and carries on with its normal handling.
 */
class ParentStackStatusReader {
  private readonly client: CloudFormationClient;
  private readonly logger: LoggerBuffer | undefined;

  constructor(client: CloudFormationClient, logger: LoggerBuffer | undefined) {
    this.client = client;
    this.logger = logger;
  }

  /** The stack's status; undefined when the stack is not returned or the lookup fails (not found, access denied, ...). */
  public async read(stackId: StackId): Promise<StackStatus | undefined> {
    try {
      const response = await this.client.send(new DescribeStacksCommand({ StackName: stackId }));
      return response.Stacks?.[0]?.StackStatus;
    } catch (failure) {
      return this.warnUnreadable(failure);
    }
  }

  private warnUnreadable(failure: unknown): undefined {
    this.logger?.warn(`Failed to check parent stack status: ${new CaughtError(failure).message ?? String(failure)}`);
    return undefined;
  }
}

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
  const status = await new ParentStackStatusReader(cfnClient, logger).read(stackId);
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
  const status = await new ParentStackStatusReader(cfnClient, logger).read(stackId);
  return status === 'DELETE_IN_PROGRESS';
}
