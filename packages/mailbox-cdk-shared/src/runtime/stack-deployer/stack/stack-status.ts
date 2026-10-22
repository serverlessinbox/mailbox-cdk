import type { StackStatus as CloudFormationStackStatus } from '@aws-sdk/client-cloudformation';

/**
 * A CloudFormation stack status, classified for the deployment workflow. It decides only from the status
 * text; where a status leads (retry, recreate, answer) is the worker's call.
 */
export class StackStatus {
  readonly value: CloudFormationStackStatus | undefined;

  constructor(value: CloudFormationStackStatus | undefined) {
    this.value = value;
  }

  /** True for a status from which CloudFormation refuses every update; deleting the stack and creating it again is the recovery. */
  static requiresRecreate(value: CloudFormationStackStatus | undefined): boolean {
    return value === 'ROLLBACK_FAILED' || value === 'ROLLBACK_COMPLETE';
  }

  /** A deploy finished well: any `*_COMPLETE` except a rollback or a delete. */
  isTerminalSuccess(): boolean {
    if (!this.value) {
      return false;
    }
    if (this.isDeleting()) {
      return false;
    }
    return this.value.endsWith('_COMPLETE') && !this.value.includes('ROLLBACK');
  }

  /** Any status containing `ROLLBACK` or `FAILED`, the in-progress rollback statuses included. */
  isDeploymentFailed(): boolean {
    if (!this.value) {
      return false;
    }
    return this.value.includes('ROLLBACK') || this.value.includes('FAILED');
  }

  /** A status from which CloudFormation refuses every update; deleting the stack and creating it again is the recovery. */
  requiresRecreate(): boolean {
    return StackStatus.requiresRecreate(this.value);
  }

  isRollbackInProgress(): boolean {
    return this.value === 'ROLLBACK_IN_PROGRESS';
  }

  /** Any `DELETE_*` status: a stack being torn down can never satisfy a create or an update. */
  isDeleting(): boolean {
    return this.value?.startsWith('DELETE_') ?? false;
  }

  /** A failed delete is transient while Lambda@Edge replicas drain, so the delete is tried again. */
  isDeleteFailed(): boolean {
    return this.value === 'DELETE_FAILED';
  }
}
