import {
  DescribeStacksCommand,
  type CloudFormationClient,
  type StackStatus,
} from '@aws-sdk/client-cloudformation';

import { CaughtError }       from '../errors/caught-error';
import type { LoggerBuffer } from '../logger-buffer';

import type { StackId }      from './custom-resource-identifiers';

/**
 * Answers the two questions a custom resource asks about the status of its parent CloudFormation stack before it
 * answers a request: is the stack rolling back, and is it being deleted. A status that cannot be read counts as
 * neither. The failure is logged at warn level on the logger the class was given, when there is one.
 */
export class ParentStackStatus {
  private readonly cloudFormation: CloudFormationClient;
  private readonly logger: LoggerBuffer | undefined;

  constructor(cloudFormation: CloudFormationClient, logger?: LoggerBuffer) {
    this.cloudFormation = cloudFormation;
    this.logger         = logger;
  }

  /**
   * Whether the parent stack is rolling back (`UPDATE_ROLLBACK_IN_PROGRESS`).
   *
   * During a rollback, CloudFormation sends custom-resource Update handlers the old properties
   * and expects SUCCESS responses. Answering FAILED during rollback leaves the stack in
   * UPDATE_ROLLBACK_FAILED, which is undeletable without manual intervention.
   */
  public async isRollingBack(stackId: StackId): Promise<boolean> {
    const status = await this.readStatus(stackId);
    return status === 'UPDATE_ROLLBACK_IN_PROGRESS';
  }

  /**
   * Whether the parent stack is being deleted (`DELETE_IN_PROGRESS`).
   *
   * A custom resource also receives Delete when it is merely replaced or removed from a stack that
   * stays alive; only a Delete during stack deletion means the whole stack is going away. When the
   * status cannot be read this reports false, so the caller skips destructive work: skipping leaves
   * orphans that can be reclaimed later, while acting wrongly destroys live resources.
   */
  public async isBeingDeleted(stackId: StackId): Promise<boolean> {
    const status = await this.readStatus(stackId);
    return status === 'DELETE_IN_PROGRESS';
  }

  /** The stack's status; undefined when the stack is not returned or the lookup fails (not found, access denied, ...). */
  private async readStatus(stackId: StackId): Promise<StackStatus | undefined> {
    try {
      const response = await this.cloudFormation.send(new DescribeStacksCommand({ StackName: stackId }));
      return response.Stacks?.[0]?.StackStatus;
    } catch (failure) {
      return this.warnUnreadable(failure);
    }
  }

  private warnUnreadable(failure: unknown): undefined {
    this.logger?.warn(`Failed to check parent stack status: ${new CaughtError(failure).readableMessage()}`);
    return undefined;
  }
}
