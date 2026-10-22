import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import { CaughtError, type LoggerBuffer }   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import * as t                               from 'typanion';

import type { LambdaFunctionArn }           from '../updater-identifiers';

/**
 * What a smoke-test probe found:
 * - 'pass': the function initialized successfully
 * - 'fail': the function failed to initialize (a FunctionError or an answer of false)
 * - 'unprobeable': the invoke failed or the answer could not be read (network, permissions, throttle)
 */
export type SmokeTestVerdict = 'pass' | 'fail' | 'unprobeable';

const isJsonObject = t.isPartial({});

const isSmokeTestAnswer = t.isPartial({ serverlessInboxSmokeTestOk: t.isBoolean() });

/**
 * Probes a Lambda function with the smoke-test payload to learn whether its code initializes in its
 * environment. It only reports a verdict; whether to keep or roll back the code is the caller's decision.
 */
export class FunctionSmokeTester {
  private readonly logger: LoggerBuffer;

  constructor(logger: LoggerBuffer) {
    this.logger = logger;
  }

  public async probe(lambda: LambdaClient, functionArn: LambdaFunctionArn): Promise<SmokeTestVerdict> {
    try {
      const response = await lambda.send(
        new InvokeCommand({
          FunctionName:   functionArn,
          InvocationType: 'RequestResponse',
          Payload:        JSON.stringify({ serverlessInboxSmokeTest: true }),
        }),
      );

      if (response.FunctionError) {
        this.logger.warn('smoke test failed: function error', {
          functionArn,
          functionError: response.FunctionError,
        });
        return 'fail';
      }

      return this.verdictOf(functionArn, response.Payload);
    } catch (thrown) {
      return this.unprobeableInvoke(functionArn, thrown);
    }
  }

  private verdictOf(functionArn: LambdaFunctionArn, payload: Uint8Array | undefined): SmokeTestVerdict {
    if (!payload) {
      this.logger.warn('smoke test unprobeable: no response payload', { functionArn });
      return 'unprobeable';
    }

    const answer = this.parseAnswer(functionArn, payload);
    if (answer === undefined) {
      return 'unprobeable';
    }

    if (!isJsonObject(answer)) {
      this.logger.warn('smoke test unprobeable: response payload is not an object', {
        functionArn,
        payloadType: typeof answer,
      });
      return 'unprobeable';
    }

    const problems: string[] = [];
    if (!isSmokeTestAnswer(answer, { errors: problems })) {
      this.logger.warn('smoke test unprobeable: response lacks serverlessInboxSmokeTestOk field or wrong type', {
        functionArn,
        problems: problems.join('; '),
      });
      return 'unprobeable';
    }

    if (answer.serverlessInboxSmokeTestOk) {
      return 'pass';
    }
    this.logger.warn('smoke test failed: handler returned ok:false', { functionArn });
    return 'fail';
  }

  /** The decoded JSON answer, or undefined when the payload is not JSON. */
  private parseAnswer(functionArn: LambdaFunctionArn, payload: Uint8Array): unknown {
    try {
      return JSON.parse(new TextDecoder().decode(payload));
    } catch (thrown) {
      this.logger.warn('smoke test unprobeable: failed to parse response payload', {
        functionArn,
        error: new CaughtError(thrown).message,
      });
      return undefined;
    }
  }

  private unprobeableInvoke(functionArn: LambdaFunctionArn, thrown: unknown): SmokeTestVerdict {
    const caught = new CaughtError(thrown);
    this.logger.warn('smoke test unprobeable: invoke failed', {
      functionArn,
      error: caught.message,
      code:  caught.name,
    });
    return 'unprobeable';
  }
}
