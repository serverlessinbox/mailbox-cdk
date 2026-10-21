/** The retry counters the workflow carries from one check to the next. */
export interface RetryCounts {
  readonly deleteRetryCount: number;
  readonly createRetryCount: number;
}

/**
 * What a worker invocation returns to the Step Functions workflow: whether the stack operation is over, and
 * the retry counters the next check starts from. The invocations that do not carry the counters leave them
 * out.
 */
export class WorkerResult {
  readonly done: boolean;
  readonly deleteRetryCount?: number;
  readonly createRetryCount?: number;

  private constructor(done: boolean, retries?: RetryCounts) {
    this.done             = done;
    this.deleteRetryCount = retries?.deleteRetryCount;
    this.createRetryCount = retries?.createRetryCount;
  }

  /** The operation is over and CloudFormation has been answered; the workflow stops polling. */
  static finished(retries?: RetryCounts): WorkerResult {
    return new WorkerResult(true, retries);
  }

  /** The operation is still running; the workflow waits and checks again. */
  static pollAgain(retries?: RetryCounts): WorkerResult {
    return new WorkerResult(false, retries);
  }
}
