import type { PatVerdict } from './auth-tokens';

/** At most this many verdicts are held for one table; the oldest is dropped to admit a new one. */
const MAX_ENTRIES = 1000;

/** How long a usable verdict is held, before the row's own expiry caps it. */
const USABLE_TTL_MS = 5 * 60 * 1000;

/** How long an unusable verdict is held, so a junk or freshly revoked secret is not read on every request. */
const UNUSABLE_TTL_MS = 60 * 1000;

/** A verdict with the time it stops being held, in epoch milliseconds. */
interface CachedVerdict {
  readonly verdict:   PatVerdict;
  readonly heldUntil: number;
}

/**
 * Holds the verdicts of one personal access token lookup table, keyed by the hash of the secret. A usable verdict
 * is held for five minutes and never past the row's `expiresAt`; an unusable one for a minute. Concurrent requests
 * for one hash share a single read, and a failed read is never held: it is thrown to every caller that shared it.
 * The clock is injected so the hold times are fixed by the tests.
 */
export class PatVerdictCache {
  private readonly now: () => number;
  private readonly heldByHash = new Map<string, CachedVerdict>();
  private readonly readsInFlight = new Map<string, Promise<PatVerdict>>();

  constructor(now: () => number) {
    this.now = now;
  }

  /** The held verdict for a hash, or the verdict `readVerdict` reads for it, which is then held. */
  public verdictFor(hash: string, readVerdict: () => Promise<PatVerdict>): Promise<PatVerdict> {
    const held = this.heldVerdict(hash);
    if (held !== undefined) {
      return Promise.resolve(held);
    }

    const inFlight = this.readsInFlight.get(hash);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const read = this.readAndHold(hash, readVerdict);
    this.readsInFlight.set(hash, read);
    return read;
  }

  private heldVerdict(hash: string): PatVerdict | undefined {
    const held = this.heldByHash.get(hash);
    if (held === undefined) {
      return undefined;
    }
    if (this.now() >= held.heldUntil) {
      this.heldByHash.delete(hash);
      return undefined;
    }
    return held.verdict;
  }

  private async readAndHold(hash: string, readVerdict: () => Promise<PatVerdict>): Promise<PatVerdict> {
    try {
      const verdict = await readVerdict();
      this.hold(hash, verdict);
      return verdict;
    } finally {
      this.readsInFlight.delete(hash);
    }
  }

  private hold(hash: string, verdict: PatVerdict): void {
    this.heldByHash.delete(hash);
    if (this.heldByHash.size >= MAX_ENTRIES) {
      const oldest = this.heldByHash.keys().next();
      if (!oldest.done) {
        this.heldByHash.delete(oldest.value);
      }
    }
    this.heldByHash.set(hash, { verdict, heldUntil: this.heldUntil(verdict) });
  }

  private heldUntil(verdict: PatVerdict): number {
    const now = this.now();
    if (!verdict.usable) {
      return now + UNUSABLE_TTL_MS;
    }
    return Math.min(now + USABLE_TTL_MS, verdict.expiresAt);
  }
}
