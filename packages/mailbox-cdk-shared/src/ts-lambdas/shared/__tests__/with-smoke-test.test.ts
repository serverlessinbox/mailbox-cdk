/**
 * Tests for withSmokeTest wrapper.
 *
 * Verifies that smoke test probes bypass the real handler entirely,
 * while real traffic and CloudFormation events pass through correctly.
 */

import { withSmokeTest } from '../with-smoke-test';

describe('withSmokeTest', () => {
  describe('probe interception', () => {
    it('intercepts probe payload and returns success without invoking handler', async () => {
      const handlerMock = jest.fn(async () => ({
        statusCode: 200,
        body: 'real response',
      }));

      const wrapped = withSmokeTest(handlerMock);

      const probePayload = { serverlessInboxSmokeTest: true };
      const result = await wrapped(probePayload, {}, undefined);

      // Handler must not have been called
      expect(handlerMock).not.toHaveBeenCalled();

      // Response must be the smoke test success marker
      expect(result).toEqual({
        serverlessInboxSmokeTestOk: true,
      });
    });

    it('handles probe as JSON string', async () => {
      const handlerMock = jest.fn(async () => ({
        statusCode: 200,
      }));

      const wrapped = withSmokeTest(handlerMock);

      const probeString = JSON.stringify({ serverlessInboxSmokeTest: true });
      const result = await wrapped(probeString, {}, undefined);

      expect(handlerMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        serverlessInboxSmokeTestOk: true,
      });
    });

    it('ignores flag if other keys present (treats as real event)', async () => {
      const handlerMock = jest.fn(async () => ({
        statusCode: 200,
        body: 'real response',
      }));

      const wrapped = withSmokeTest(handlerMock);

      // Payload has the flag but also other keys
      const fakeProbe = {
        serverlessInboxSmokeTest: true,
        RequestType: 'Create', // Looks like a real CloudFormation event
      };

      const result = await wrapped(fakeProbe, {}, undefined);

      // Should treat this as real traffic
      expect(handlerMock).toHaveBeenCalledWith(fakeProbe, {}, undefined);
      expect(result).toEqual({
        statusCode: 200,
        body: 'real response',
      });
    });
  });

  describe('real traffic passthrough', () => {
    it('passes CloudFormation events through to handler', async () => {
      const cfnEvent = {
        RequestType: 'Create',
        ResponseURL: 'https://example.com/response',
        StackId: 'arn:aws:cloudformation:...',
        RequestId: '12345',
        ResourceType: 'Custom::MyResource',
        LogicalResourceId: 'MyResource',
        ResourceProperties: { Key: 'Value' },
      };

      const cfnResponse = {
        Status: 'SUCCESS',
        PhysicalResourceId: 'physical-id',
        StackId: cfnEvent.StackId,
        RequestId: cfnEvent.RequestId,
        LogicalResourceId: cfnEvent.LogicalResourceId,
      };

      const handlerMock = jest.fn(async () => cfnResponse);
      const wrapped = withSmokeTest(handlerMock);

      const result = await wrapped(cfnEvent, {}, undefined);

      expect(handlerMock).toHaveBeenCalledWith(cfnEvent, {}, undefined);
      expect(result).toEqual(cfnResponse);
    });

    it('passes regular event handler events through', async () => {
      const apiEvent = {
        httpMethod: 'GET',
        path: '/api/users',
        headers: { Authorization: 'Bearer token' },
      };

      const apiResponse = {
        statusCode: 200,
        body: JSON.stringify([{ id: 1, name: 'Alice' }]),
      };

      const handlerMock = jest.fn(async () => apiResponse);
      const wrapped = withSmokeTest(handlerMock);

      const result = await wrapped(apiEvent, {}, undefined);

      expect(handlerMock).toHaveBeenCalledWith(apiEvent, {}, undefined);
      expect(result).toEqual(apiResponse);
    });

    it('passes through SQS events', async () => {
      const sqsEvent = {
        Records: [
          {
            messageId: '12345',
            body: JSON.stringify({ action: 'process' }),
          },
        ],
      };

      const handlerMock = jest.fn(async () => ({}));
      const wrapped = withSmokeTest(handlerMock);

      const result = await wrapped(sqsEvent, {}, undefined);

      expect(handlerMock).toHaveBeenCalledWith(sqsEvent, {}, undefined);
    });
  });

  describe('error handling', () => {
    it('propagates handler errors on real traffic', async () => {
      const error = new Error('Handler failed');
      const handlerMock = jest.fn(async () => {
        throw error;
      });

      const wrapped = withSmokeTest(handlerMock);

      const realEvent = { method: 'GET', path: '/' };

      await expect(wrapped(realEvent, {}, undefined)).rejects.toThrow('Handler failed');
      expect(handlerMock).toHaveBeenCalledWith(realEvent, {}, undefined);
    });

    it('swallows handler errors on probe invocation (handler not called)', async () => {
      // This is a moot test since handler is not called on probe,
      // but documenting the expected behavior for completeness
      const handlerMock = jest.fn(async () => {
        throw new Error('Should not be called');
      });

      const wrapped = withSmokeTest(handlerMock);

      const result = await wrapped({ serverlessInboxSmokeTest: true }, {}, undefined);

      expect(handlerMock).not.toHaveBeenCalled();
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });
  });

  describe('callback-style invocation', () => {
    it('supports callback-based Lambda runtime', (done) => {
      const handlerMock = jest.fn(async () => ({
        result: 'data',
      }));

      const wrapped = withSmokeTest(handlerMock);

      const callback = jest.fn((err: any, result: any) => {
        expect(err).toBeNull();
        expect(result).toEqual({
          serverlessInboxSmokeTestOk: true,
        });
        expect(handlerMock).not.toHaveBeenCalled();
        done();
      });

      wrapped({ serverlessInboxSmokeTest: true }, {}, callback);
    });

    it('delegates real events to handler with callback', (done) => {
      const handlerMock = jest.fn(async (event: any) => ({
        processed: event.id,
      }));

      const wrapped = withSmokeTest(handlerMock);

      const callback = jest.fn((err: any, result: any) => {
        expect(err).toBeNull();
        expect(result).toEqual({
          processed: 123,
        });
        expect(handlerMock).toHaveBeenCalledWith({ id: 123 }, {}, callback);
        done();
      });

      wrapped({ id: 123 }, {}, callback);
    });
  });

  describe('malformed probe handling', () => {
    it('treats invalid JSON as real event', async () => {
      const handlerMock = jest.fn(async () => ({
        statusCode: 200,
      }));

      const wrapped = withSmokeTest(handlerMock);

      // Invalid JSON string
      const result = await wrapped('not valid json', {}, undefined);

      expect(handlerMock).toHaveBeenCalledWith('not valid json', {}, undefined);
      expect(result).toEqual({ statusCode: 200 });
    });

    it('treats null/undefined as real event', async () => {
      const handlerMock = jest.fn(async () => ({
        statusCode: 200,
      }));

      const wrapped = withSmokeTest(handlerMock);

      await wrapped(null, {}, undefined);
      await wrapped(undefined, {}, undefined);

      expect(handlerMock).toHaveBeenCalledTimes(2);
    });
  });
});
