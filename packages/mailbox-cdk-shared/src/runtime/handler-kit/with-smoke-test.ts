import * as t from 'typanion';

/**
 * A smoke-test check: throws to fail the probe, returns to pass it.
 */
export type Check = () => Promise<void> | void;

/**
 * The only payload of a probe. The schema rejects any other key, so a real event that happens to carry the flag
 * beside its own fields is real traffic.
 */
const isSmokeTestProbeShape = t.isObject({ serverlessInboxSmokeTest: t.isLiteral(true) });

/**
 * Smoke test probe payload.
 */
export type SmokeTestProbe = Partial<t.InferType<typeof isSmokeTestProbeShape>>;

/**
 * Smoke test response payload.
 */
export interface SmokeTestResponse {
  serverlessInboxSmokeTestOk: boolean;
}

/**
 * Lets a deployed function say whether its code and its configuration still fit together, without doing any real
 * work: it recognises a probe and answers it from the registered checks. It never reaches the wrapped handler, so it
 * reports only on initialisation health, not on how the handler behaves.
 */
class SmokeTestSeam {
  private readonly checks: readonly Check[];

  constructor(checks: readonly Check[]) {
    this.checks = checks;
  }

  /** True for the probe object itself or for JSON text of it; any other event, including text that is not JSON, is real traffic. */
  public isProbe(event: unknown): boolean {
    const payload = typeof event === 'string' ? this.parseJson(event) : event;
    return isSmokeTestProbeShape(payload);
  }

  public async answer(): Promise<SmokeTestResponse> {
    return { serverlessInboxSmokeTestOk: await this.allChecksPass() };
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /** Runs the checks in order and stops at the first one that throws. */
  private async allChecksPass(): Promise<boolean> {
    for (const check of this.checks) {
      try {
        await check();
      } catch {
        return false;
      }
    }
    return true;
  }
}

/**
 * Wraps a Lambda handler so that a probe is answered without reaching it.
 *
 * A probe runs every check and answers `{ serverlessInboxSmokeTestOk: true }` when all pass, or `false` when one
 * throws. Every other event is passed to the handler unchanged, and an error the handler throws propagates.
 */
export function withSmokeTest<TEvent, TContext, TResult>(
  handler: (event: TEvent, context: TContext, ...rest: never[]) => Promise<TResult> | void,
  ...checks: Check[]
): (
  event: TEvent | SmokeTestProbe | string,
  context?: TContext,
) => Promise<TResult | SmokeTestResponse> {
  const seam = new SmokeTestSeam(checks);

  // Node.js Lambda runtimes reject a handler declared with a third formal
  // parameter at Init, before any invocation — the function returned here
  // must declare exactly two (event, context).
  return async (event, context) => {
    if (seam.isProbe(event)) {
      return seam.answer();
    }

    // cast (event): a string that is not a probe is real traffic in the handler's own event shape.
    // cast (context): optional here so callers whose handler ignores context can omit it; the Lambda runtime
    // always passes one to a handler that uses it.
    // cast (result): aws-lambda's Handler type permits a legacy callback-style (void) return beside the Promise,
    // and every handler in this codebase is async.
    return (await handler(event as TEvent, context as TContext)) as TResult;
  };
}
