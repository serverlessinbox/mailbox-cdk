import * as crypto from 'crypto';

const LOWERCASE      = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE      = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS         = '0123456789';
const ALL_CHARACTERS = LOWERCASE + UPPERCASE + DIGITS;

/**
 * Generates a password of the given length, made of lowercase letters, uppercase letters and digits, with at least
 * one of each; the length must be at least 3. Every choice comes from `crypto.randomInt`, never `Math.random`: the
 * password is an initial credential and must not be predictable from observed output.
 */
export function generateSecurePassword(length: number): string {
  const passwordChars: string[] = [];

  // One character of each required type is chosen from its own set, so the policy is always met.
  for (const requiredSet of [LOWERCASE, UPPERCASE, DIGITS]) {
    passwordChars.push(requiredSet[crypto.randomInt(0, requiredSet.length)]);
  }

  while (passwordChars.length < length) {
    passwordChars.push(ALL_CHARACTERS[crypto.randomInt(0, ALL_CHARACTERS.length)]);
  }

  // Fisher-Yates with cryptographic random selection, so the required characters do not sit at fixed positions.
  for (let i = passwordChars.length - 1; i > 0; i--) {
    const j                              = crypto.randomInt(0, i + 1);
    [passwordChars[i], passwordChars[j]] = [passwordChars[j], passwordChars[i]];
  }

  return passwordChars.join('');
}
