/**
 * Pins what the authorizer accepts of a CloudFront origin-request event. The request it returns must be the
 * object CloudFront delivered, so that the fields it does not read reach the origin unchanged; an event of any
 * other shape is refused as an expected failure instead of failing on a missing field.
 */

import { ExpectedFailure } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { firstHeaderValue, readOriginRequest } from '../cloudfront-event';
import { cloudFrontEventOf } from './blob-authorizer-helpers';

const VALID_REQUEST = {
  method: 'GET',
  uri: '/download',
  querystring: 'accountId=a1&blobId=YWJj',
  headers: { authorization: [{ key: 'Authorization', value: 'Bearer token' }] },
  clientIp: '203.0.113.7',
  origin: { s3: { domainName: 'bucket.s3.amazonaws.com', customHeaders: { 'x-region': [{ key: 'x-region', value: 'eu-west-1' }] } } },
};

describe('readOriginRequest', () => {
  it('returns the very request object of the first record, with the fields it does not read', () => {
    const event = cloudFrontEventOf(VALID_REQUEST) as { Records: Array<{ cf: { request: unknown } }> };

    const request = readOriginRequest(event);

    expect(request).toBe(event.Records[0].cf.request);
    expect(request).toHaveProperty('clientIp', '203.0.113.7');
  });

  it('accepts a request without a query string, a uri or an origin', () => {
    const request = readOriginRequest(cloudFrontEventOf({ method: 'GET', headers: {} }));

    expect(request.querystring).toBeUndefined();
    expect(request.origin).toBeUndefined();
  });

  it.each([
    ['not an object', 'a string'],
    ['null', null],
    ['an event without records', {}],
    ['an event with no record', { Records: [] }],
    ['a record without cf', { Records: [{}] }],
    ['a record without a request', { Records: [{ cf: {} }] }],
    ['a request without a method', cloudFrontEventOf({ headers: {} })],
    ['a request without headers', cloudFrontEventOf({ method: 'GET' })],
    ['a header that is not a list', cloudFrontEventOf({ method: 'GET', headers: { authorization: 'Bearer token' } })],
    ['a header value that is not a string', cloudFrontEventOf({ method: 'GET', headers: { authorization: [{ value: 7 }] } })],
    ['a query string that is not a string', cloudFrontEventOf({ method: 'GET', headers: {}, querystring: 7 })],
    ['origin custom headers that are not a map of lists', cloudFrontEventOf({
      method: 'GET', headers: {}, origin: { s3: { customHeaders: { 'x-region': 'eu-west-1' } } },
    })],
  ])('refuses %s as an expected failure', (_name, event) => {
    expect(() => readOriginRequest(event)).toThrow(ExpectedFailure);
    expect(() => readOriginRequest(event)).toThrow(/^Malformed CloudFront event: /);
  });
});

describe('firstHeaderValue', () => {
  const request = readOriginRequest(cloudFrontEventOf({
    method: 'GET',
    headers: {
      origin: [{ key: 'Origin', value: 'https://first.example.com' }, { key: 'Origin', value: 'https://second.example.com' }],
      empty: [],
      keyless: [{}],
    },
  }));

  it('returns the first value of a header that has several', () => {
    expect(firstHeaderValue(request.headers, 'origin')).toBe('https://first.example.com');
  });

  it.each(['absent', 'empty', 'keyless'])('returns undefined for the %s header', (name) => {
    expect(firstHeaderValue(request.headers, name)).toBeUndefined();
  });

  it('returns undefined when there are no headers at all', () => {
    expect(firstHeaderValue(undefined, 'origin')).toBeUndefined();
  });
});
