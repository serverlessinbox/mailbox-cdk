/**
 * Pins the smoke-test wrapper: a probe is answered without reaching the wrapped handler, and every other event
 * reaches it unchanged. A probe that leaked into the handler would hit its assumptions about the event shape, and a
 * wrapper that changed real traffic would break every function it wraps.
 */

import { withSmokeTest } from '../with-smoke-test';

describe('withSmokeTest', () => {
  it('answers a probe without invoking the handler', async () => {
    const handlerMock = jest.fn(async () => ({ statusCode: 200 }));
    const wrapped     = withSmokeTest(handlerMock);

    const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

    expect(handlerMock).not.toHaveBeenCalled();
    expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
  });

  it('answers a probe with the outcome of its checks', async () => {
    const failingCheck = jest.fn(() => {
      throw new Error('Config validation failed');
    });
    const wrapped      = withSmokeTest(jest.fn(async () => ({})), failingCheck);

    const result = await wrapped({ serverlessInboxSmokeTest: true }, {});

    expect(result).toEqual({ serverlessInboxSmokeTestOk: false });
  });

  it('passes real traffic and its context to the handler and returns the handler result', async () => {
    const cfnEvent    = { RequestType: 'Create', ResponseURL: 'https://example.com/response', LogicalResourceId: 'MyResource' };
    const handlerMock = jest.fn(async () => ({ Status: 'SUCCESS' }));
    const wrapped     = withSmokeTest(handlerMock);

    const result = await wrapped(cfnEvent, {});

    expect(handlerMock).toHaveBeenCalledWith(cfnEvent, {});
    expect(result).toEqual({ Status: 'SUCCESS' });
  });

  it('does not run the checks for real traffic', async () => {
    const check   = jest.fn(async () => undefined);
    const wrapped = withSmokeTest(jest.fn(async () => ({ statusCode: 200 })), check);

    await wrapped({ method: 'GET' }, {});

    expect(check).not.toHaveBeenCalled();
  });

  it('propagates an error the handler throws', async () => {
    const handlerMock = jest.fn(async () => {
      throw new Error('Handler failed');
    });
    const wrapped     = withSmokeTest(handlerMock);

    await expect(wrapped({ method: 'GET' }, {})).rejects.toThrow('Handler failed');
  });

  it('returns a function that declares exactly two parameters, because Node.js Lambda runtimes reject a third at Init', () => {
    const wrapped = withSmokeTest(jest.fn(async () => ({})));

    expect(wrapped.length).toBe(2);
  });
});
