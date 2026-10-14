/**
 * Pins the exact responses the authorizer hands a viewer: the status, description, content type and JSON body
 * of an error, and the CORS preflight headers. Browsers reject a download whose preflight answer drifts.
 */

import { CloudFrontResponses } from '../cloudfront-responses';

describe('CloudFrontResponses.error', () => {
  it('answers the status as a string, the message as its description and a JSON body carrying the message', () => {
    expect(CloudFrontResponses.error(403, 'Access denied: invalid blob')).toEqual({
      status: '403',
      statusDescription: 'Access denied: invalid blob',
      headers: { 'content-type': [{ key: 'Content-Type', value: 'application/json' }] },
      body: '{"error":"Access denied: invalid blob"}',
    });
  });
});

describe('CloudFrontResponses.corsPreflight', () => {
  const allowedHeaders = {
    'access-control-allow-methods': [{ key: 'Access-Control-Allow-Methods', value: 'GET, HEAD, OPTIONS' }],
    'access-control-allow-headers': [{ key: 'Access-Control-Allow-Headers', value: 'Authorization, Content-Type, Cache-Control' }],
    'access-control-allow-credentials': [{ key: 'Access-Control-Allow-Credentials', value: 'true' }],
    'access-control-max-age': [{ key: 'Access-Control-Max-Age', value: '3600' }],
  };

  it('echoes the request origin', () => {
    expect(CloudFrontResponses.corsPreflight('https://webmail.example.com')).toEqual({
      status: '200',
      statusDescription: 'OK',
      headers: {
        'access-control-allow-origin': [{ key: 'Access-Control-Allow-Origin', value: 'https://webmail.example.com' }],
        ...allowedHeaders,
      },
    });
  });

  it('allows any origin when the request names none', () => {
    expect(CloudFrontResponses.corsPreflight(undefined).headers['access-control-allow-origin']).toEqual([
      { key: 'Access-Control-Allow-Origin', value: '*' },
    ]);
  });
});
