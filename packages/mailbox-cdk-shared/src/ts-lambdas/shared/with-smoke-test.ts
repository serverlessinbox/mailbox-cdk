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
 */

/**
 * Smoke test probe payload (always single-property JSON).
 */
interface SmokeTestProbe {
  serverlessInboxSmokeTest?: true;
}

/**
 * Smoke test response payload.
 */
interface SmokeTestResponse {
  serverlessInboxSmokeTestOk: boolean;
}

/**
 * Wraps a Lambda handler to intercept smoke test probes.
 *
 * @param handler The underlying Lambda handler (any shape: async function, CloudFormationCustomResourceHandler, etc.)
 * @returns A wrapped handler that intercepts probes and delegates real traffic to the original handler
 *
 * For event-based handlers:
 *   - Probe: returns `{ serverlessInboxSmokeTestOk: true }` without invoking handler
 *   - Real event: delegates to handler unchanged
 *
 * For custom-resource handlers:
 *   - Probe (no RequestType/ResponseURL): returns `{ serverlessInboxSmokeTestOk: true }` without invoking handler
 *   - CFN event (has RequestType/ResponseURL): delegates to handler unchanged
 *
 * The handler's own error handling is unchanged — no special behavior on errors.
 * If the handler throws during a real invocation, the error propagates normally.
 */
export function withSmokeTest<T extends (...args: any[]) => any>(handler: T): T {
  return (async (event: any, context: any, callback: any) => {
    // Check if this is a smoke test probe:
    // - Parse as JSON if it's a string
    // - Check for the telltale serverlessInboxSmokeTest flag
    let probe: SmokeTestProbe | null = null;
    if (typeof event === 'object' && event !== null) {
      probe = event as SmokeTestProbe;
    } else if (typeof event === 'string') {
      try {
        const parsed = JSON.parse(event);
        probe = parsed as SmokeTestProbe;
      } catch {
        // Not JSON, treat as real event
        probe = null;
      }
    }

    // If this is a probe (has serverlessInboxSmokeTest: true) and nothing else:
    // For safety, we require ONLY the probe flag to minimize false positives.
    // A real event that happens to have this flag alongside RequestType/method/etc.
    // should be treated as real traffic, not a probe.
    const isProbe =
      probe !== null &&
      probe.serverlessInboxSmokeTest === true &&
      Object.keys(probe).length === 1; // Only the probe flag, nothing else

    if (isProbe) {
      // Return success response and do not invoke the real handler
      const response: SmokeTestResponse = {
        serverlessInboxSmokeTestOk: true,
      };

      // Handle different Lambda invocation modes
      if (callback) {
        // Callback-style invocation
        callback(null, response);
      } else if (context && typeof context.succeed === 'function') {
        // ALB/API Gateway style
        context.succeed(response);
      } else {
        // Promise-based (default for Node.js)
        return response;
      }
      return;
    }

    // Real traffic: invoke the underlying handler unchanged
    // Preserve the original function signature and error handling
    try {
      const result = await handler(event, context, callback);
      // If handler uses callbacks (callback provided and handler returned), callback handles response
      // If handler returns a Promise, we need to resolve it and call callback if provided
      if (callback && typeof result !== 'undefined') {
        callback(null, result);
      } else {
        return result;
      }
    } catch (error) {
      if (callback) {
        callback(error);
      } else {
        throw error;
      }
    }
  }) as T;
}
