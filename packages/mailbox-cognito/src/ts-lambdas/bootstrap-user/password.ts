import * as crypto from 'crypto';

/**
 * Generate a cryptographically unpredictable random password that meets Cognito policy requirements.
 * Returns a 16-character password containing lowercase, uppercase, and digits.
 * Never logged or exposed in responses.
 *
 * Uses Node's built-in crypto.randomInt (CSPRNG) because this password is the initial admin
 * credential for the entire deployment. Math.random() would be recoverable from observed outputs,
 * violating the security requirement for an initial credential.
 */
export function generateSecurePassword(): string {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  // Symbols are allowed by Cognito but not required; we exclude them for simplicity
  const allChars = lowercase + uppercase + digits;

  const passwordChars: string[] = [];

  // Ensure at least one of each required character type by selecting from specific sets
  passwordChars.push(lowercase[crypto.randomInt(0, lowercase.length)]);
  passwordChars.push(uppercase[crypto.randomInt(0, uppercase.length)]);
  passwordChars.push(digits[crypto.randomInt(0, digits.length)]);

  // Fill remaining 13 positions with random characters from the full set
  for (let i = 3; i < 16; i++) {
    passwordChars.push(allChars[crypto.randomInt(0, allChars.length)]);
  }

  // Shuffle using Fisher-Yates with cryptographic random selection to avoid predictable structure
  for (let i = passwordChars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [passwordChars[i], passwordChars[j]] = [passwordChars[j], passwordChars[i]];
  }

  return passwordChars.join('');
}

/** Marker returned in Data.temporaryPassword when password was set at install time and is not recoverable. */
export const PASSWORD_SET_AT_INSTALL_TIME = '(password set at install time)';
