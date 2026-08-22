/// <reference types="jest" />

import { isClientRegistrationRequest } from '../dcr.validation';

describe('isClientRegistrationRequest', () => {
  it('accepts a minimal valid RFC 7591 request', () => {
    const body = { redirect_uris: ['http://127.0.0.1:1234/cb'] };
    expect(isClientRegistrationRequest(body)).toBe(true);
  });

  it('accepts the full non-normative RFC 7591 §3.1 example shape', () => {
    const body = {
      redirect_uris: ['https://client.example.org/callback', 'https://client.example.org/callback2'],
      client_name: 'My Example Client',
      token_endpoint_auth_method: 'client_secret_basic',
      logo_uri: 'https://client.example.org/logo.png',
      jwks_uri: 'https://client.example.org/my_public_keys.jwks',
      example_extension_parameter: 'example_value',
    };
    expect(isClientRegistrationRequest(body)).toBe(true);
  });

  it('rejects a request missing redirect_uris', () => {
    expect(isClientRegistrationRequest({ client_name: 'No redirects' })).toBe(false);
  });

  it('rejects a request with an empty redirect_uris array', () => {
    expect(isClientRegistrationRequest({ redirect_uris: [] })).toBe(false);
  });

  it('rejects a request where redirect_uris is not an array of strings', () => {
    expect(isClientRegistrationRequest({ redirect_uris: [123] })).toBe(false);
  });

  it('ignores an unrecognized extension field rather than rejecting (RFC 7591 §2)', () => {
    const body = { redirect_uris: ['http://127.0.0.1/cb'], some_future_field: { nested: true } };
    expect(isClientRegistrationRequest(body)).toBe(true);
  });

  it('accepts a software_statement field without inspecting it (decision #9: ignored, not rejected)', () => {
    const body = { redirect_uris: ['http://127.0.0.1/cb'], software_statement: 'not-a-real-jwt' };
    expect(isClientRegistrationRequest(body)).toBe(true);
  });
});
