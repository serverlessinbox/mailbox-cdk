/// <reference types="jest" />

/**
 * Pins the validation of the `DCR_CHECK` response. A duplicate registration is answered with the client it
 * duplicates; a `dedup_hit` that names no client would be answered to the registering client as a success with
 * nothing to authenticate with, so it must fail validation instead.
 */

import { isDcrCheckResponse } from '../identity-provisioner-contract';

function errorsOf(response: unknown): string[] {
  const errors: string[] = [];
  isDcrCheckResponse(response, { errors });
  return errors;
}

describe('isDcrCheckResponse', () => {
  it.each([
    ['a duplicate with its client and scope', { status: 'dedup_hit', clientId: 'existing-client', scope: 'openid email' }],
    ['a duplicate with its client only', { status: 'dedup_hit', clientId: 'existing-client' }],
    ['a registration that may proceed', { status: 'proceed' }],
    ['a tenant over its cap', { status: 'cap_exceeded' }],
  ])('accepts %s', (_label, response) => {
    expect(isDcrCheckResponse(response)).toBe(true);
  });

  it('rejects a duplicate that names no client', () => {
    const response = { status: 'dedup_hit', scope: 'openid email' };

    expect(isDcrCheckResponse(response)).toBe(false);
    expect(errorsOf(response).join('; ')).toContain('clientId');
  });

  it.each([
    ['a registration that may proceed', { status: 'proceed', clientId: 'existing-client' }],
    ['a tenant over its cap', { status: 'cap_exceeded', clientId: 'existing-client' }],
  ])('rejects %s that carries a client', (_label, response) => {
    expect(isDcrCheckResponse(response)).toBe(false);
  });
});
