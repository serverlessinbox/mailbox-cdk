import type * as Https from 'https';
import { Writable }    from 'stream';
import * as t          from 'typanion';

const isCapturedCfnResponse = t.isPartial({
  Status:             t.isString(),
  Reason:             t.isOptional(t.isString()),
  PhysicalResourceId: t.isOptional(t.isString()),
  Data:               t.isOptional(t.isRecord(t.isString())),
});

/** The fields of the CloudFormation response that Lambda runtime tests assert on. */
export type CapturedCfnResponse = t.InferType<typeof isCapturedCfnResponse>;

/**
 * Routes the `https.request` a wrapped handler makes to its ResponseURL into memory and returns a function
 * yielding the CloudFormation response body it PUT. The test file must `jest.mock('https', ...)` with a
 * `request: jest.fn()` first. The `https` module is read when this is called rather than at import, so a test
 * that resets the module registry and loads its handler afterwards captures the same instance the handler uses.
 * The returned function throws when nothing was PUT, and when the body is not a CloudFormation response.
 */
export function captureCfnResponse(): () => CapturedCfnResponse {
  const https = require('https') as typeof Https;
  let body    = '';
  jest.mocked(https.request).mockImplementation(((_options: unknown, onResponse?: (response: { statusCode: number }) => void) => {
    onResponse?.({ statusCode: 200 });
    return new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
        body += chunk.toString();
        done();
      },
    });
  }) as typeof https.request);

  return () => {
    if (body === '') {
      throw new Error('the handler sent no CloudFormation response to its ResponseURL');
    }
    const sent: unknown = JSON.parse(body);
    t.assert(sent, isCapturedCfnResponse);
    return sent;
  };
}
