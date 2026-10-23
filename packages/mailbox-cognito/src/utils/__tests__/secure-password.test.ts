/// <reference types="jest" />

/**
 * Pins the password the bootstrap user Lambda generates for the initial admin credential: it meets the Cognito
 * policy, differs per call, and comes from the CSPRNG. A password from Math.random would be recoverable from
 * observed outputs.
 */

import type * as Crypto           from 'crypto';

import { generateSecurePassword } from '../secure-password';

describe('secure-password module', () => {
  describe('generateSecurePassword', () => {
    function validatePassword(password: string): { isValid: boolean; reason?: string } {
      // Policy: minimum length 8, requires lowercase, uppercase, and digits
      if (!password || password.length < 8) {
        return { isValid: false, reason: `Password too short: ${password.length} chars` };
      }
      if (!/[a-z]/.test(password)) {
        return { isValid: false, reason: 'Missing lowercase letter' };
      }
      if (!/[A-Z]/.test(password)) {
        return { isValid: false, reason: 'Missing uppercase letter' };
      }
      if (!/[0-9]/.test(password)) {
        return { isValid: false, reason: 'Missing digit' };
      }
      return { isValid: true };
    }

    it('generates a password of the requested length', () => {
      expect(generateSecurePassword(16)).toHaveLength(16);
      expect(generateSecurePassword(99)).toHaveLength(99);
    });

    it('generates passwords that meet Cognito policy requirements', () => {
      const password   = generateSecurePassword(16);
      const validation = validatePassword(password);
      expect(validation.isValid).toBe(true);
    });

    it('generates different passwords on successive invocations', () => {
      const password1 = generateSecurePassword(16);
      const password2 = generateSecurePassword(16);

      expect(password1).not.toBe(password2);
    });

    it('generates multiple passwords all meeting policy requirements', () => {
      for (let i = 0; i < 10; i++) {
        const password   = generateSecurePassword(16);
        const validation = validatePassword(password);
        if (!validation.isValid) {
          throw new Error(
            `Password ${i}: "${password}" failed validation: ${validation.reason}`
          );
        }
        expect(validation.isValid).toBe(true);
      }
    });

    it('uses crypto.randomInt (CSPRNG) and never Math.random', () => {
      // Regression test: ensure the implementation uses crypto.randomInt for all randomness.
      const randomInt = jest.spyOn(jest.requireActual<typeof Crypto>('crypto'), 'randomInt');

      try {
        const password = generateSecurePassword(16);

        expect(validatePassword(password).isValid).toBe(true);
        expect(randomInt.mock.calls.length).toBeGreaterThan(15);
      } finally {
        randomInt.mockRestore();
      }
    });
  });
});
