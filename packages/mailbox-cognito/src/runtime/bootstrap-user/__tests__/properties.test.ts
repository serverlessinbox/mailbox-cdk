/// <reference types="jest" />

/**
 * Pins the boundaries of the `passwordMinLength` property of the bootstrap user resource. CloudFormation passes
 * every property as a string, and Cognito accepts a password policy length from 6 to 99, so the schema must accept
 * exactly the decimal spellings of that range: a looser one lets the Lambda call Cognito with a length it rejects
 * after the stack has already been created, and a stricter one rejects a length the template allows.
 */

import { isBootstrapUserProperties } from '../properties';

function acceptsPasswordMinLength(passwordMinLength: string): boolean {
  return isBootstrapUserProperties({ userPoolId: 'pool-1', passwordMinLength });
}

describe('isBootstrapUserProperties passwordMinLength', () => {
  it.each(['6', '9', '10', '99'])('accepts %s', (value) => {
    expect(acceptsPasswordMinLength(value)).toBe(true);
  });

  it.each(['5', '100', '08', '0', '', ' 8', '8 ', '1e1', '-8', '8.5'])('rejects %j', (value) => {
    expect(acceptsPasswordMinLength(value)).toBe(false);
  });

  it('accepts a resource that sets no password minimum', () => {
    expect(isBootstrapUserProperties({ userPoolId: 'pool-1' })).toBe(true);
  });
});
