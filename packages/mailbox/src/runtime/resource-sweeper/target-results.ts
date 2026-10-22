import type { RemovalId, TargetResult } from './removal';

/**
 * Builds the `TargetResult`s of one removal target, so every outcome carries the same target label
 * and shape. It does not decide an outcome.
 */
export class TargetResults {
  constructor(private readonly target: RemovalId) {}

  /** The target is confirmed gone. */
  public done(): TargetResult {
    return { target: this.target, status: 'SUCCESS' };
  }

  /** The target is not deletable yet; `reason` says what it is waiting on. */
  public retry(reason: string): TargetResult {
    return { target: this.target, status: 'RETRY', reason };
  }

  /** The sweep cannot succeed on a retry; `reason` says why. */
  public failed(reason: string): TargetResult {
    return { target: this.target, status: 'FAILED', reason };
  }
}
