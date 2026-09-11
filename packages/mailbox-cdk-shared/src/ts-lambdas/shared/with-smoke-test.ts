/**
 * Lambda smoke test wrapper: verifies init health without reaching the real handler.
 *
 * Wraps any handler (event-based or custom-resource) to intercept probe payloads
 * with `{ serverlessInboxSmokeTest: true }` and respond healthily without invoking
 * the wrapped handler. Real traffic and CloudFormation events pass through.
 *
 * For custom-resource handlers (which use wrapHandler from aws-custom-resources),
 * withSmokeTest MUST wrap the wrapHandler-wrapped function to ensure probes never
 * reach wrapHandler's assumptions about RequestType/ResponseURL:
 *
 *   export const handler = withSmokeTest(wrapHandler(async (event) => { ... }));
 *
 * For regular event handlers, withSmokeTest simply wraps the handler:
 *
 *   export const handler = withSmokeTest(async (event) => { ... });
 *
 * Optional checks can be registered to validate initialization state (e.g., config);
 * they are run against every probe and must all pass for the probe to succeed:
 *
 *   const configCheck = () => { validateConfig(); };
 *   export const handler = withSmokeTest(asyncHandler, configCheck);
 */

/**
 * A smoke-test check function: returns void or a promise that resolves to void.
 * Throw to indicate failure; returning means check passed.
 */
export type Check = () => Promise<void> | void;

/**
 * Smoke test probe payload (always single-property JSON).
 */
export interface SmokeTestProbe {
  serverlessInboxSmokeTest?: true;
}

/**
 * Smoke test response payload.
 */
export interface SmokeTestResponse {
  serverlessInboxSmokeTestOk: boolean;
}

/**
 * Type guard: detects a smoke test probe payload.
 *
 * - Parses `event` as JSON first if it's a string.
 * - Requires ONLY the `serverlessInboxSmokeTest: true` flag and nothing else,
 *   to minimize false positives: a real event that happens to carry this flag
 *   alongside RequestType/method/etc. is treated as real traffic, not a probe.
 */
function isSmokeTestProbe(event: unknown): event is SmokeTestProbe {
  let probe: SmokeTestProbe | null = null;
  if (typeof event === 'object' && event !== null) {
    probe = event as SmokeTestProbe;
  } else if (typeof event === 'string') {
    try {
      probe = JSON.parse(event) as SmokeTestProbe;
    } catch {
      probe = null;
    }
  }
  return probe !== null && probe.serverlessInboxSmokeTest === true && Object.keys(probe).length === 1;
}

/**
 * Wraps a Lambda handler to intercept smoke test probes.
 *
 * @param handler The underlying Lambda handler (any shape: async function, CloudFormationCustomResourceHandler, etc.)
 * @param checks Optional variadic check functions to run against probes.
 *               Each check is called during probe interception; if any throws, the probe fails.
 *               Checks are not called for real traffic.
 * @returns A wrapped handler that intercepts probes and delegates real traffic to the original handler.
 *          The returned handler accepts the original handler's event type OR a SmokeTestProbe,
 *          and returns either the handler's result OR a SmokeTestResponse.
 *
 * For event-based handlers:
 *   - Probe: runs all checks; returns `{ serverlessInboxSmokeTestOk: true }` if all pass,
 *     or `{ serverlessInboxSmokeTestOk: false }` if any check throws
 *   - Real event: delegates to handler unchanged
 *
 * For custom-resource handlers:
 *   - Probe (no RequestType/ResponseURL): runs all checks; returns success/failure response
 *   - CFN event (has RequestType/ResponseURL): delegates to handler unchanged
 *
 * The handler's own error handling is unchanged — no special behavior on errors.
 * If the handler throws (or its returned promise rejects) during a real
 * invocation, the error propagates normally as a rejected promise.
 */
export function withSmokeTest<TEvent, TContext, TResult>(
  handler: (event: TEvent, context: TContext, ...rest: never[]) => Promise<TResult> | void,
  ...checks: Check[]
): (
  event: TEvent | SmokeTestProbe | string,
  context?: TContext,
) => Promise<TResult | SmokeTestResponse> {
  // Node.js Lambda runtimes reject a handler declared with a third formal
  // parameter at Init, before any invocation — the function returned here
  // must declare exactly two (event, context).
  return async (event, context) => {
    if (isSmokeTestProbe(event)) {
      // Run all checks in order; if any throw, the probe fails.
      let ok = true;
      for (const check of checks) {
        try {
          await check();
        } catch {
          ok = false;
          break;
        }
      }

      const response: SmokeTestResponse = {
        serverlessInboxSmokeTestOk: ok,
      };
      return response;
    }

    // cast (event): a string that failed JSON parsing above is real traffic
    // in the handler's own event shape, not further narrowable structurally.
    // cast (context): optional here so callers whose handler ignores context
    // can omit it; handlers that use context are always invoked by the real
    // Lambda runtime with one present.
    // cast (result): aws-lambda's Handler type permits a legacy callback-style
    // (void) return alongside the Promise; every handler in this codebase is
    // async, so this always resolves to TResult at runtime.
    const result = (await handler(event as TEvent, context as TContext)) as TResult;
    return result;
  };
}
