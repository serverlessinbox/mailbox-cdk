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
    { response: { status: 'dedup_hit', clientId: 'existing-client', scope: 'openid email' }, describes: 'a duplicate with its client and scope' },
    { response: { status: 'dedup_hit', clientId: 'existing-client' }, describes: 'a duplicate with its client only' },
    { response: { status: 'proceed' }, describes: 'a registration that may proceed' },
    { response: { status: 'cap_exceeded' }, describes: 'a tenant over its cap' },
  ])('accepts $describes', ({ response }) => {
    expect(isDcrCheckResponse(response)).toBe(true);
  });

  it('rejects a duplicate that names no client', () => {
    const response = { status: 'dedup_hit', scope: 'openid email' };

    expect(isDcrCheckResponse(response)).toBe(false);
    expect(errorsOf(response).join('; ')).toContain('clientId');
  });

  it.each([
    { response: { status: 'proceed', clientId: 'existing-client' }, describes: 'a registration that may proceed' },
    { response: { status: 'cap_exceeded', clientId: 'existing-client' }, describes: 'a tenant over its cap' },
  ])('rejects $describes that carries a client', ({ response }) => {
    expect(isDcrCheckResponse(response)).toBe(false);
  });
});
