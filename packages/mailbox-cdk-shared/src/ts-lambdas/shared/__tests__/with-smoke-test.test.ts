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
      const result = await wrapped(probePayload, {});

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
      const result = await wrapped(probeString, {});

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

      const result = await wrapped(fakeProbe, {});

      // Should treat this as real traffic
      expect(handlerMock).toHaveBeenCalledWith(fakeProbe, {});
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

      const result = await wrapped(cfnEvent, {});

      expect(handlerMock).toHaveBeenCalledWith(cfnEvent, {});
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

      const result = await wrapped(apiEvent, {});

      expect(handlerMock).toHaveBeenCalledWith(apiEvent, {});
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

      await wrapped(sqsEvent, {});

      expect(handlerMock).toHaveBeenCalledWith(sqsEvent, {});
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

      await expect(wrapped(realEvent, {})).rejects.toThrow('Handler failed');
      expect(handlerMock).toHaveBeenCalledWith(realEvent, {});
    });

    it('swallows handler errors on probe invocation (handler not called)', async () => {
      // This is a moot test since handler is not called on probe,
      // but documenting the expected behavior for completeness
      const handlerMock = jest.fn(async () => {
        throw new Error('Should not be called');
      });

      const wrapped = withSmokeTest(handlerMock);

      const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

      expect(handlerMock).not.toHaveBeenCalled();
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });
  });

  // Callback-style invocation is intentionally unsupported: Node.js Lambda runtimes
  // reject a handler declared with a third formal parameter at Init starting with
  // Node.js 24 (Runtime.CallbackHandlerDeprecated), regardless of whether the
  // parameter is ever invoked. withSmokeTest's returned function must declare
  // exactly two parameters (event, context) to stay eligible on that runtime.

  describe('malformed probe handling', () => {
    it('treats invalid JSON as real event', async () => {
      const handlerMock = jest.fn(async () => ({
        statusCode: 200,
      }));

      const wrapped = withSmokeTest(handlerMock);

      // Invalid JSON string
      const result = await wrapped('not valid json', {});

      expect(handlerMock).toHaveBeenCalledWith('not valid json', {});
      expect(result).toEqual({ statusCode: 200 });
    });

    it('treats null/undefined as real event', async () => {
      const handlerMock = jest.fn(async () => ({
        statusCode: 200,
      }));

      const wrapped = withSmokeTest(handlerMock);

      await wrapped(null, {});
      await wrapped(undefined, {});

      expect(handlerMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('optional checks', () => {
    it('zero checks: probe succeeds without invoking handler', async () => {
      const handlerMock = jest.fn(async () => ({}));

      // No checks registered
      const wrapped = withSmokeTest(handlerMock);

      const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

      expect(handlerMock).not.toHaveBeenCalled();
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });

    it('all checks pass: probe succeeds', async () => {
      const handlerMock = jest.fn(async () => ({}));

      const check1 = jest.fn(async () => {
        // Check passes
      });
      const check2 = jest.fn(async () => {
        // Check passes
      });

      const wrapped = withSmokeTest(handlerMock, check1, check2);

      const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

      expect(check1).toHaveBeenCalled();
      expect(check2).toHaveBeenCalled();
      expect(handlerMock).not.toHaveBeenCalled();
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });

    it('first check fails: probe fails without running remaining checks', async () => {
      const handlerMock = jest.fn(async () => ({}));

      const failingCheck = jest.fn(async () => {
        throw new Error('Config validation failed');
      });
      const unreachedCheck = jest.fn(async () => {
        // Should not be called
      });

      const wrapped = withSmokeTest(handlerMock, failingCheck, unreachedCheck);

      const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

      expect(failingCheck).toHaveBeenCalled();
      expect(unreachedCheck).not.toHaveBeenCalled();
      expect(handlerMock).not.toHaveBeenCalled();
      expect(result).toEqual({ serverlessInboxSmokeTestOk: false });
    });

    it('checks are not run on real traffic', async () => {
      const handlerMock = jest.fn(async () => ({
        statusCode: 200,
      }));

      const check = jest.fn(async () => {
        throw new Error('Should not be called');
      });

      const wrapped = withSmokeTest(handlerMock, check);

      const realEvent = { method: 'GET', path: '/' };
      const result = await wrapped(realEvent, {});

      expect(check).not.toHaveBeenCalled();
      expect(handlerMock).toHaveBeenCalledWith(realEvent, {});
      expect(result).toEqual({ statusCode: 200 });
    });

    it('supports synchronous checks', async () => {
      const handlerMock = jest.fn(async () => ({}));

      let checkCalled = false;
      const syncCheck = () => {
        checkCalled = true;
      };

      const wrapped = withSmokeTest(handlerMock, syncCheck);

      const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

      expect(checkCalled).toBe(true);
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });

    it('supports asynchronous checks', async () => {
      const handlerMock = jest.fn(async () => ({}));

      const asyncCheck = jest.fn(async () => {
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 1));
      });

      const wrapped = withSmokeTest(handlerMock, asyncCheck);

      const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

      expect(asyncCheck).toHaveBeenCalled();
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });

    it('backward compatible: existing zero-check call sites work identically', async () => {
      const handlerMock = jest.fn(async () => ({ statusCode: 200 }));

      // Old-style call with no checks
      const wrapped = withSmokeTest(handlerMock);

      // Probe should still work
      const probeResult = await wrapped({ serverlessInboxSmokeTest: true }, {});
      expect(probeResult).toEqual({ serverlessInboxSmokeTestOk: true });

      // Real traffic should still pass through
      const realEvent = { method: 'GET' };
      const realResult = await wrapped(realEvent, {});
      expect(handlerMock).toHaveBeenCalledWith(realEvent, {});
      expect(realResult).toEqual({ statusCode: 200 });
    });
  });
});
