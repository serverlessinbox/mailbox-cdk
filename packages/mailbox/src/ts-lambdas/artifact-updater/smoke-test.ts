/**
 * Lambda smoke test: verify a function's init health by invoking it with a probe payload.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { LoggerBuffer } from '../shared/logger-buffer';

/**
 * Verdict from a smoke test probe.
 * - 'pass': function initialized successfully
 * - 'fail': function failed to initialize (FunctionError or false response)
 * - 'unprobeable': invoke failed or response unparseable (network, permissions, etc.)
 */
export type SmokeTestVerdict = 'pass' | 'fail' | 'unprobeable';

/**
 * Invoke a Lambda function with a smoke-test probe payload to verify its init health.
 *
 * Returns a verdict:
 * - 'pass': response body contains `{"serverlessInboxSmokeTestOk": true}`
 * - 'fail': function returned a FunctionError, or response body has `serverlessInboxSmokeTestOk === false`
 * - 'unprobeable': invocation failed (API-level error, network, throttle, etc.) or response body unparseable
 *
 * Logs warnings for unprobeable and failures; the caller decides whether to retry or proceed.
 */
export async function invokeSmokeTest(
  client: LambdaClient,
  functionArn: string,
  logger: LoggerBuffer,
): Promise<SmokeTestVerdict> {
  try {
    const response = await client.send(
      new InvokeCommand({
        FunctionName: functionArn,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({ serverlessInboxSmokeTest: true }),
      }),
    );

    // Check for function-level error (FunctionError field present and non-empty)
    if (response.FunctionError) {
      logger.warn('smoke test failed: function error', {
        functionArn,
        functionError: response.FunctionError,
      });
      return 'fail';
    }

    // Parse response body
    if (!response.Payload) {
      logger.warn('smoke test unprobeable: no response payload', { functionArn });
      return 'unprobeable';
    }

    let payload: unknown;
    try {
      const payloadStr = typeof response.Payload === 'string'
        ? response.Payload
        : new TextDecoder().decode(response.Payload as Uint8Array);
      payload = JSON.parse(payloadStr);
    } catch (err: any) {
      logger.warn('smoke test unprobeable: failed to parse response payload', {
        functionArn,
        error: err.message,
      });
      return 'unprobeable';
    }

    // Check response structure
    if (typeof payload !== 'object' || payload === null) {
      logger.warn('smoke test unprobeable: response payload is not an object', {
        functionArn,
        payloadType: typeof payload,
      });
      return 'unprobeable';
    }

    const payloadObj = payload as Record<string, unknown>;
    const ok = payloadObj.serverlessInboxSmokeTestOk;

    if (ok === true) {
      return 'pass';
    }

    if (ok === false) {
      logger.warn('smoke test failed: handler returned ok:false', { functionArn });
      return 'fail';
    }

    // Response present but wrong structure
    logger.warn('smoke test unprobeable: response lacks serverlessInboxSmokeTestOk field or wrong type', {
      functionArn,
      receivedOk: ok,
    });
    return 'unprobeable';
  } catch (err: any) {
    // API-level exception: AccessDenied, ResourceNotFound, throttle, network, etc.
    logger.warn('smoke test unprobeable: invoke failed', {
      functionArn,
      error: err.message,
      code: err.name,
    });
    return 'unprobeable';
  }
}
