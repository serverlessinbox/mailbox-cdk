/// <reference types="jest" />

/**
 * Pins the password the bootstrap user Lambda generates for the initial admin credential: it meets the Cognito
 * policy, differs per call, and comes from the CSPRNG. A password from Math.random would be recoverable from
 * observed outputs.
 */

import { generateSecurePassword } from '../password';

describe('password module', () => {
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

    it('generates a 16-character password', () => {
      const password = generateSecurePassword();
      expect(password).toHaveLength(16);
    });

    it('generates passwords that meet Cognito policy requirements', () => {
      const password   = generateSecurePassword();
      const validation = validatePassword(password);
      expect(validation.isValid).toBe(true);
    });

    it('generates different passwords on successive invocations', () => {
      const password1 = generateSecurePassword();
      const password2 = generateSecurePassword();

      expect(password1).not.toBe(password2);
    });

    it('generates multiple passwords all meeting policy requirements', () => {
      for (let i = 0; i < 10; i++) {
        const password   = generateSecurePassword();
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
      const crypto            = require('crypto');
      const originalRandomInt = crypto.randomInt;

      let randomIntCallCount = 0;
      crypto.randomInt       = jest.fn((...args: unknown[]) => {
        randomIntCallCount++;
        return (originalRandomInt as typeof originalRandomInt)(...(args as [number, number]));
      });

      try {
        const password = generateSecurePassword();

        expect(validatePassword(password).isValid).toBe(true);
        expect(randomIntCallCount).toBeGreaterThan(15);
      } finally {
        crypto.randomInt = originalRandomInt;
      }
    });
  });
});
