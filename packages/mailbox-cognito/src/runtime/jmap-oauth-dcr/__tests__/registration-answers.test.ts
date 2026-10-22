/// <reference types="jest" />

/**
 * Pins the shape of the HTTP answers of the registration endpoint. A client reads the status and the
 * `error` code, and a response that carries a registration must not be cached.
 */

import { RegistrationAnswers } from '../registration-answers';

describe('RegistrationAnswers', () => {
  const uncacheableJson = {
    'content-type':  'application/json',
    'cache-control': 'no-store',
    pragma:          'no-cache',
  };

  it('answers a created registration with 201 and the client information as JSON', () => {
    const answer = RegistrationAnswers.created({
      client_id:                  'client-1',
      client_id_issued_at:        1_700_000_000,
      redirect_uris:              ['http://127.0.0.1/cb'],
      token_endpoint_auth_method: 'none',
      client_name:                'My App',
      scope:                      'openid email',
    });

    expect(answer.statusCode).toBe(201);
    expect(answer.headers).toEqual(uncacheableJson);
    expect(JSON.parse(answer.body ?? '')).toEqual({
      client_id:                  'client-1',
      client_id_issued_at:        1_700_000_000,
      redirect_uris:              ['http://127.0.0.1/cb'],
      token_endpoint_auth_method: 'none',
      client_name:                'My App',
      scope:                      'openid email',
    });
  });

  it('answers a rejection with its status, its error code and its description', () => {
    const answer = RegistrationAnswers.rejected(429, 'invalid_client_metadata', 'Registration cap exceeded for this tenant');

    expect(answer.statusCode).toBe(429);
    expect(answer.headers).toEqual(uncacheableJson);
    expect(JSON.parse(answer.body ?? '')).toEqual({
      error:             'invalid_client_metadata',
      error_description: 'Registration cap exceeded for this tenant',
    });
  });

  it('leaves error_description out of a rejection without a description, and of one with an empty description', () => {
    expect(JSON.parse(RegistrationAnswers.rejected(400, 'invalid_redirect_uri').body ?? '')).toEqual({ error: 'invalid_redirect_uri' });
    expect(JSON.parse(RegistrationAnswers.rejected(400, 'invalid_redirect_uri', '').body ?? '')).toEqual({ error: 'invalid_redirect_uri' });
  });

  it('answers an internal error with 500 and the server_error code', () => {
    const answer = RegistrationAnswers.internalError();

    expect(answer.statusCode).toBe(500);
    expect(JSON.parse(answer.body ?? '')).toEqual({
      error:             'server_error',
      error_description: 'Internal error processing registration',
    });
  });
});
