/**
 * Pins the smoke-test seam: a probe is answered without reaching the wrapped handler, and every other event reaches
 * it unchanged. A probe that leaked into the handler would hit its assumptions about the event shape, and real
 * traffic mistaken for a probe would be answered with a health marker instead of being processed.
 */

import { withSmokeTest } from '../with-smoke-test';

describe('withSmokeTest', () => {
  describe('probe', () => {
    it('is answered healthy without invoking the handler', async () => {
      const handlerMock = jest.fn(async () => ({ statusCode: 200 }));
      const wrapped = withSmokeTest(handlerMock);

      const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

      expect(handlerMock).not.toHaveBeenCalled();
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });

    it('is recognised as JSON text', async () => {
      const handlerMock = jest.fn(async () => ({ statusCode: 200 }));
      const wrapped = withSmokeTest(handlerMock);

      const result = await wrapped(JSON.stringify({ serverlessInboxSmokeTest: true }), {});

      expect(handlerMock).not.toHaveBeenCalled();
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });
  });

  describe('real traffic', () => {
    it('reaches the handler and returns its result', async () => {
      const cfnEvent = { RequestType: 'Create', ResponseURL: 'https://example.com/response', LogicalResourceId: 'MyResource' };
      const handlerMock = jest.fn(async () => ({ Status: 'SUCCESS' }));
      const wrapped = withSmokeTest(handlerMock);

      const result = await wrapped(cfnEvent, {});

      expect(handlerMock).toHaveBeenCalledWith(cfnEvent, {});
      expect(result).toEqual({ Status: 'SUCCESS' });
    });

    it('reaches the handler when the event carries the probe flag beside other keys', async () => {
      const flaggedEvent = { serverlessInboxSmokeTest: true, RequestType: 'Create' };
      const handlerMock = jest.fn(async () => ({ statusCode: 200 }));
      const wrapped = withSmokeTest(handlerMock);

      const result = await wrapped(flaggedEvent, {});

      expect(handlerMock).toHaveBeenCalledWith(flaggedEvent, {});
      expect(result).toEqual({ statusCode: 200 });
    });

    it('reaches the handler when the probe flag is not true', async () => {
      const handlerMock = jest.fn(async () => ({ statusCode: 200 }));
      const wrapped = withSmokeTest(handlerMock);

      await wrapped({ serverlessInboxSmokeTest: false }, {});

      expect(handlerMock).toHaveBeenCalledTimes(1);
    });

    it('reaches the handler when the event is text that is not JSON', async () => {
      const handlerMock = jest.fn(async () => ({ statusCode: 200 }));
      const wrapped = withSmokeTest(handlerMock);

      const result = await wrapped('not valid json', {});

      expect(handlerMock).toHaveBeenCalledWith('not valid json', {});
      expect(result).toEqual({ statusCode: 200 });
    });

    it('reaches the handler when the event is null or undefined', async () => {
      const handlerMock = jest.fn(async () => ({ statusCode: 200 }));
      const wrapped = withSmokeTest(handlerMock);

      await wrapped(null, {});
      await wrapped(undefined, {});

      expect(handlerMock).toHaveBeenCalledTimes(2);
    });

    it('propagates an error the handler throws', async () => {
      const handlerMock = jest.fn(async () => {
        throw new Error('Handler failed');
      });
      const wrapped = withSmokeTest(handlerMock);

      await expect(wrapped({ method: 'GET' }, {})).rejects.toThrow('Handler failed');
    });
  });

  // withSmokeTest's returned function must declare exactly two parameters (event, context): Node.js Lambda
  // runtimes reject a handler declared with a third formal parameter at Init (Runtime.CallbackHandlerDeprecated).
  describe('checks', () => {
    it('all pass: the probe is answered healthy', async () => {
      const check1 = jest.fn(async () => undefined);
      const check2 = jest.fn(() => undefined);
      const wrapped = withSmokeTest(jest.fn(async () => ({})), check1, check2);

      const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

      expect(check1).toHaveBeenCalledTimes(1);
      expect(check2).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });

    it('the first to throw fails the probe and the remaining checks do not run', async () => {
      const failingCheck = jest.fn(async () => {
        throw new Error('Config validation failed');
      });
      const unreachedCheck = jest.fn(async () => undefined);
      const wrapped = withSmokeTest(jest.fn(async () => ({})), failingCheck, unreachedCheck);

      const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

      expect(unreachedCheck).not.toHaveBeenCalled();
      expect(result).toEqual({ serverlessInboxSmokeTestOk: false });
    });

    it('a synchronous check that throws fails the probe', async () => {
      const syncFailingCheck = jest.fn(() => {
        throw new Error('Config validation failed');
      });
      const wrapped = withSmokeTest(jest.fn(async () => ({})), syncFailingCheck);

      const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

      expect(result).toEqual({ serverlessInboxSmokeTestOk: false });
    });

    it('do not run for real traffic', async () => {
      const check = jest.fn(async () => undefined);
      const wrapped = withSmokeTest(jest.fn(async () => ({ statusCode: 200 })), check);

      await wrapped({ method: 'GET' }, {});

      expect(check).not.toHaveBeenCalled();
    });
  });
});
