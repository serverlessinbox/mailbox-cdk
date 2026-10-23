/// <reference types="jest" />

/**
 * Pins the capture of the CloudFormation response a wrapped handler PUTs: the body written to the request is read
 * back as the response, a run that PUTs nothing is a failure rather than an empty answer, and a body that is not
 * a CloudFormation response is refused.
 */

import * as https             from 'https';

import { captureCfnResponse } from '../cfn-response-capture';

jest.mock('https', () => ({
  request: jest.fn(),
}));

/** Sends one body to the ResponseURL the way the wrapped handler does: a request, the body written, then ended. */
function putToResponseUrl(body: string): void {
  const request = https.request({ host: 'example.com', method: 'PUT' });
  request.write(body);
  request.end();
}

describe('captureCfnResponse', () => {
  it('reads back the body the handler PUT as the response', () => {
    const readResponse = captureCfnResponse();

    putToResponseUrl(JSON.stringify({ Status: 'SUCCESS', PhysicalResourceId: 'physical-id-1' }));

    expect(readResponse()).toEqual({ Status: 'SUCCESS', PhysicalResourceId: 'physical-id-1' });
  });

  it('throws when the handler PUT nothing', () => {
    const readResponse = captureCfnResponse();

    expect(() => readResponse()).toThrow('the handler sent no CloudFormation response to its ResponseURL');
  });

  it('refuses a body with no Status', () => {
    const readResponse = captureCfnResponse();

    putToResponseUrl(JSON.stringify({ Reason: 'no status field' }));

    expect(() => readResponse()).toThrow('Type mismatch');
  });
});
