import * as crypto from 'crypto';

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS    = '0123456789';
// Symbols are allowed by Cognito but not required; they are left out for simplicity.
const ALL_CHARACTERS  = LOWERCASE + UPPERCASE + DIGITS;
const PASSWORD_LENGTH = 16;

/**
 * Generate a cryptographically unpredictable random password that meets Cognito policy requirements.
 * Returns a 16-character password containing lowercase, uppercase, and digits. Never logged.
 *
 * Uses Node's built-in crypto.randomInt (CSPRNG) because this password is the initial admin
 * credential for the entire deployment. Math.random() would be recoverable from observed outputs,
 * violating the security requirement for an initial credential.
 */
export function generateSecurePassword(): string {
  const passwordChars: string[] = [];

  // One character of each required type is chosen from its own set, so the policy is always met.
  for (const requiredSet of [LOWERCASE, UPPERCASE, DIGITS]) {
    passwordChars.push(requiredSet[crypto.randomInt(0, requiredSet.length)]);
  }

  while (passwordChars.length < PASSWORD_LENGTH) {
    passwordChars.push(ALL_CHARACTERS[crypto.randomInt(0, ALL_CHARACTERS.length)]);
  }

  // Fisher-Yates with cryptographic random selection, so the required characters do not sit at fixed positions.
  for (let i = passwordChars.length - 1; i > 0; i--) {
    const j                              = crypto.randomInt(0, i + 1);
    [passwordChars[i], passwordChars[j]] = [passwordChars[j], passwordChars[i]];
  }

  return passwordChars.join('');
}

/** Marker returned in Data.temporaryPassword when password was set at install time and is not recoverable. */
export const PASSWORD_SET_AT_INSTALL_TIME = '(password set at install time)';
