import { SmokeTestSeam }                                 from './smoke-test-seam';
import type { Check, SmokeTestProbe, SmokeTestResponse } from './smoke-test';

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
