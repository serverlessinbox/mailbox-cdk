import type { TargetResult } from './removal';

/**
 * Builds the `TargetResult`s of one removal target, so every outcome carries the same target label
 * and shape. It does not decide an outcome.
 */
export class TargetResults {
  constructor(private readonly target: string) {}

  /** The target is confirmed gone. */
  public done(): TargetResult {
    return { target: this.target, status: 'done' };
  }

  /** The target is not deletable yet; `reason` says what it is waiting on. */
  public retry(reason: string): TargetResult {
    return { target: this.target, status: 'retry', reason };
  }

  /** The sweep cannot succeed on a retry; `reason` says why. */
  public failed(reason: string): TargetResult {
    return { target: this.target, status: 'failed', reason };
  }
}
