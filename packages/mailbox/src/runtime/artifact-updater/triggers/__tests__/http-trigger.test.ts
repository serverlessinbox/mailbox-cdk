/// <reference types="jest" />

/**
 * Pins how the HTTP trigger answers: only a POST to a path containing `/trigger` starts an update, in the
 * background and answered 202; anything else is a 404 that starts nothing; a start that fails is answered 500
 * with the reason; a request met by a bad configuration is answered 500 naming the problem and starts nothing.
 */

import { InvokeCommand, LambdaClient }    from '@aws-sdk/client-lambda';
import { LoggerBuffer }                   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                     from 'aws-sdk-client-mock';

import { BAD_CONFIG_ERROR, httpApiEvent } from '../../__tests__/updater-helpers';
import type { HttpTriggerEvent }          from '../../updater-event';
import { HttpTrigger }                    from '../http-trigger';

describe('HttpTrigger', () => {
  const lambdaMock = mockClient(LambdaClient);

  beforeEach(() => {
    lambdaMock.reset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const lambda = new LambdaClient({ region: 'us-east-1' });

  function triggerFor(event: HttpTriggerEvent): HttpTrigger {
    return new HttpTrigger(event, () => lambda, 'artifact-updater-function', new LoggerBuffer(), undefined);
  }

  describe('handle', () => {
    it('starts an update by invoking its own function asynchronously with an empty payload, and answers 202', async () => {
      lambdaMock.on(InvokeCommand).resolves({});

      const response = await triggerFor(httpApiEvent('POST', '/artifact-updates/trigger')).handle();

      expect(response.statusCode).toBe(202);
      expect(JSON.parse(response.body)).toEqual({ status: 'triggered' });
      expect(lambdaMock.commandCalls(InvokeCommand)[0].args[0].input).toEqual({
        FunctionName:   'artifact-updater-function',
        InvocationType: 'Event',
        Payload:        '{}',
      });
    });

    it.each([
      { request: 'a GET to the trigger path', event: httpApiEvent('GET', '/artifact-updates/trigger') },
      { request: 'a POST to another path', event: httpApiEvent('POST', '/artifact-updates/status') },
    ])('answers 404 and starts nothing for $request', async ({ event }) => {
      const response = await triggerFor(event).handle();

      expect(response).toEqual({ statusCode: 404, body: '' });
      expect(lambdaMock.calls()).toHaveLength(0);
    });

    it('reads the path from the raw path when the request context has none', async () => {
      lambdaMock.on(InvokeCommand).resolves({});
      const event: HttpTriggerEvent = { rawPath: '/artifact-updates/trigger', requestContext: { http: { method: 'POST' } } };

      const response = await triggerFor(event).handle();

      expect(response.statusCode).toBe(202);
    });

    it('answers 404 for a request that names neither method nor path', async () => {
      const response = await triggerFor({ requestContext: { http: {} } }).handle();

      expect(response.statusCode).toBe(404);
    });

    it.each([
      { request: 'a request context without http', event: { requestContext: {} } },
      { request: 'a request context whose http is not an object', event: { requestContext: { http: 'POST' } } },
      { request: 'a raw path that is not text', event: { rawPath: 42, requestContext: { http: { method: 'POST' } } } },
    ])('answers 404 and starts nothing for $request', async ({ event }) => {
      const response = await triggerFor(event).handle();

      expect(response).toEqual({ statusCode: 404, body: '' });
      expect(lambdaMock.calls()).toHaveLength(0);
    });

    it('throws when the background invocation cannot be started', async () => {
      lambdaMock.on(InvokeCommand).rejects(new Error('AccessDeniedException'));

      await expect(triggerFor(httpApiEvent('POST', '/artifact-updates/trigger')).handle()).rejects.toThrow('AccessDeniedException');
    });

    it('answers 500 naming the configuration problem, logs it, and starts nothing when the configuration failed to load', async () => {
      const trigger = new HttpTrigger(
        httpApiEvent('POST', '/artifact-updates/trigger'),
        () => lambda,
        'artifact-updater-function',
        new LoggerBuffer(),
        BAD_CONFIG_ERROR,
      );

      const response = await trigger.handle();

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({ error: `Configuration error: ${BAD_CONFIG_ERROR}` });
      expect(console.error).toHaveBeenCalledWith('Configuration error', { error: BAD_CONFIG_ERROR });
      expect(lambdaMock.calls()).toHaveLength(0);
    });
  });

  describe('answerFailure', () => {
    it('answers 500 with the reason, and logs the error name and message', () => {
      const denied = new Error('not authorized');
      denied.name  = 'AccessDeniedException';

      const response = triggerFor(httpApiEvent('POST', '/artifact-updates/trigger')).answerFailure(denied);

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({ error: 'Failed to trigger update: not authorized' });
      expect(console.error).toHaveBeenCalledWith('Failed to trigger update', {
        errorName:    'AccessDeniedException',
        errorMessage: 'not authorized',
      });
    });
  });
});
