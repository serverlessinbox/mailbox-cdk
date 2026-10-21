/**
 * A CloudFormation stack status, classified for the deployment workflow. It decides only from the status
 * text; where a status leads (retry, recreate, answer) is the worker's call.
 */
export class StackStatus {
  readonly value: string | undefined;

  constructor(value: string | undefined) {
    this.value = value;
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

  isTerminalFailure(): boolean {
    if (!this.value) {
      return false;
    }
    return this.value.includes('ROLLBACK') || this.value.includes('FAILED');
  }

  /** A stack CloudFormation can no longer update, so deleting it and creating it again is the recovery. */
  requiresRecreate(): boolean {
    return this.value === 'ROLLBACK_FAILED' || this.value === 'ROLLBACK_COMPLETE';
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
