/**
 * Holds the clock and the random number generator of this process at fixed values while a piece of
 * work runs, so a synth that stamps the time or draws a random number produces the same template
 * on every run. It freezes only `Date.now` and `Math.random`; any other source of variation is
 * left alone.
 */
export class FrozenProcessValues {
  constructor(
    private readonly frozenTimeMillis: number,
    private readonly frozenRandom: number,
  ) {}

  static forBaseline(): FrozenProcessValues {
    return new FrozenProcessValues(1_700_000_000_000, 0.5);
  }

  /** Both are restored also when `work` throws; `work` must be synchronous, since the freeze ends when it returns. */
  run<T>(work: () => T): T {
    const originalNow    = Date.now;
    const originalRandom = Math.random;
    Date.now             = () => this.frozenTimeMillis;
    Math.random          = () => this.frozenRandom;
    try {
      return work();
    } finally {
      Date.now    = originalNow;
      Math.random = originalRandom;
    }
  }
}
