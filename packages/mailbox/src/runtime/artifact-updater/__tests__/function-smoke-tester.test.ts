/// <reference types="jest" />

/**
 * Pins the verdict the smoke-test probe reaches from each way an invoke can end. Only a verdict of 'pass' keeps
 * the updated code; 'fail' and 'unprobeable' roll it back, so a probe that mistook a failure or an unreadable
 * answer for a pass would keep broken code.
 */

import { InvokeCommand, LambdaClient }  from '@aws-sdk/client-lambda';
import { LoggerBuffer }                 from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                   from 'aws-sdk-client-mock';

import { FunctionSmokeTester }          from '../function-smoke-tester';

import { invokeResponse, lambdaTarget } from './updater-helpers';

describe('FunctionSmokeTester', () => {
  const lambdaMock  = mockClient(LambdaClient);
  const lambda      = new LambdaClient({ region: 'us-east-1' });
  const functionArn = lambdaTarget().arn;
  const smokeTester = new FunctionSmokeTester(new LoggerBuffer('smoke-tester', 'warn'));

  beforeEach(() => {
    lambdaMock.reset();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('invokes the function with the probe payload and waits for the answer', async () => {
    lambdaMock.on(InvokeCommand).resolves(invokeResponse('{"serverlessInboxSmokeTestOk":true}'));

    await smokeTester.probe(lambda, functionArn);

    expect(lambdaMock.commandCalls(InvokeCommand)[0].args[0].input).toEqual({
      FunctionName: functionArn,
      InvocationType: 'RequestResponse',
      Payload: '{"serverlessInboxSmokeTest":true}',
    });
  });

  it('passes when the function answers that it is healthy', async () => {
    lambdaMock.on(InvokeCommand).resolves(invokeResponse('{"serverlessInboxSmokeTestOk":true}'));

    await expect(smokeTester.probe(lambda, functionArn)).resolves.toBe('pass');
  });

  it('fails when the function answers that it is not healthy', async () => {
    lambdaMock.on(InvokeCommand).resolves(invokeResponse('{"serverlessInboxSmokeTestOk":false}'));

    await expect(smokeTester.probe(lambda, functionArn)).resolves.toBe('fail');
    expect(console.warn).toHaveBeenCalledWith('smoke test failed: handler returned ok:false', {
      functionArn,
      service: 'smoke-tester',
    });
  });

  it('fails when the invocation reports a function error', async () => {
    lambdaMock.on(InvokeCommand).resolves({
      ...invokeResponse('{"errorMessage":"process exited"}'),
      FunctionError: 'Unhandled',
    });

    await expect(smokeTester.probe(lambda, functionArn)).resolves.toBe('fail');
  });

  it('is unprobeable when the invoke is rejected, and logs the error name and message', async () => {
    const denied = new Error('not authorized to invoke');
    denied.name  = 'AccessDeniedException';
    lambdaMock.on(InvokeCommand).rejects(denied);

    await expect(smokeTester.probe(lambda, functionArn)).resolves.toBe('unprobeable');
    expect(console.warn).toHaveBeenCalledWith('smoke test unprobeable: invoke failed', {
      functionArn,
      error: 'not authorized to invoke',
      code: 'AccessDeniedException',
      service: 'smoke-tester',
    });
  });

  it('is unprobeable when the response has no payload', async () => {
    lambdaMock.on(InvokeCommand).resolves({ StatusCode: 200 });

    await expect(smokeTester.probe(lambda, functionArn)).resolves.toBe('unprobeable');
    expect(console.warn).toHaveBeenCalledWith('smoke test unprobeable: no response payload', {
      functionArn,
      service: 'smoke-tester',
    });
  });

  it('is unprobeable when the payload is not JSON', async () => {
    lambdaMock.on(InvokeCommand).resolves(invokeResponse('{ invalid json'));

    await expect(smokeTester.probe(lambda, functionArn)).resolves.toBe('unprobeable');
    expect(console.warn).toHaveBeenCalledWith(
      'smoke test unprobeable: failed to parse response payload',
      expect.objectContaining({ functionArn, error: expect.any(String) }),
    );
  });

  it.each([
    ['a string', '"not an object"', 'string'],
    ['a number', '42', 'number'],
    ['null', 'null', 'object'],
  ])('is unprobeable when the payload is %s, and logs its type', async (_description, payload, payloadType) => {
    lambdaMock.on(InvokeCommand).resolves(invokeResponse(payload));

    await expect(smokeTester.probe(lambda, functionArn)).resolves.toBe('unprobeable');
    expect(console.warn).toHaveBeenCalledWith('smoke test unprobeable: response payload is not an object', {
      functionArn,
      payloadType,
      service: 'smoke-tester',
    });
  });

  it.each([
    ['lacks the field', '{"someOtherField":"data"}'],
    ['carries the field as a string', '{"serverlessInboxSmokeTestOk":"true"}'],
  ])('is unprobeable when the answer %s', async (_description, payload) => {
    lambdaMock.on(InvokeCommand).resolves(invokeResponse(payload));

    await expect(smokeTester.probe(lambda, functionArn)).resolves.toBe('unprobeable');
    expect(console.warn).toHaveBeenCalledWith(
      'smoke test unprobeable: response lacks serverlessInboxSmokeTestOk field or wrong type',
      expect.objectContaining({ functionArn }),
    );
  });
});
