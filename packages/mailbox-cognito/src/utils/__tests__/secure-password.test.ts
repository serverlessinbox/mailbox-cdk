/// <reference types="jest" />

/**
 * Pins the password the bootstrap user Lambda generates for the initial admin credential: it meets the Cognito
 * policy, differs per call, and every choice in it comes from the CSPRNG. A password from Math.random would be
 * recoverable from observed outputs.
 */

import type * as Crypto           from 'crypto';

import { generateSecurePassword } from '../secure-password';

const MINIMUM_LENGTH_WITH_ONE_OF_EACH = 3;

/** The Cognito policy the bootstrap user pool enforces: lowercase, uppercase and a digit. */
function expectMeetsCognitoPolicy(password: string): void {
  expect(password).toMatch(/[a-z]/);
  expect(password).toMatch(/[A-Z]/);
  expect(password).toMatch(/[0-9]/);
}

describe('generateSecurePassword', () => {
  it('generates a password of the requested length', () => {
    expect(generateSecurePassword(16)).toHaveLength(16);
    expect(generateSecurePassword(99)).toHaveLength(99);
  });

  it('generates passwords that meet the Cognito policy', () => {
    for (let i = 0; i < 10; i++) {
      expectMeetsCognitoPolicy(generateSecurePassword(16));
    }
  });

  it('pads a requested length below 3 to the three characters that hold one of each kind', () => {
    const password = generateSecurePassword(1);

    expect(password).toHaveLength(MINIMUM_LENGTH_WITH_ONE_OF_EACH);
    expectMeetsCognitoPolicy(password);
  });

  it('generates different passwords on successive invocations', () => {
    expect(generateSecurePassword(16)).not.toBe(generateSecurePassword(16));
  });

  it('takes every choice from crypto.randomInt and none from Math.random', () => {
    const length     = 16;
    const randomInt  = jest.spyOn(jest.requireActual<typeof Crypto>('crypto'), 'randomInt');
    const mathRandom = jest.spyOn(Math, 'random');
    // One pick per required kind, one per remaining character, one per swap of the shuffle.
    const expectedPicks = MINIMUM_LENGTH_WITH_ONE_OF_EACH + (length - MINIMUM_LENGTH_WITH_ONE_OF_EACH) + (length - 1);

    try {
      generateSecurePassword(length);

      expect(randomInt).toHaveBeenCalledTimes(expectedPicks);
      expect(mathRandom).not.toHaveBeenCalled();
    } finally {
      randomInt.mockRestore();
      mathRandom.mockRestore();
    }
  });
});
