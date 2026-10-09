/// <reference types="jest" />

/**
 * Stack Helpers Handler Tests
 *
 * Tests for the sanitizeStackName and deriveCognitoDomainPrefix functions.
 */

import { deriveCognitoDomainPrefix, sanitizeStackName } from '../handler';

describe('Stack Helpers Handler', () => {
  describe('deriveCognitoDomainPrefix', () => {
    it('normal domain: dots are replaced with hyphens', () => {
      expect(deriveCognitoDomainPrefix('example.com', '')).toBe('example-com');
    });

    it('normal domain: multiple dots produce multiple hyphens collapsed to one', () => {
      expect(deriveCognitoDomainPrefix('mail.example.co.uk', '')).toBe('mail-example-co-uk');
    });

    it('mixed case: input is lowercased', () => {
      expect(deriveCognitoDomainPrefix('EXAMPLE.COM', '')).toBe('example-com');
    });

    it('reserved word "aws": is stripped and replaced with hyphen', () => {
      expect(deriveCognitoDomainPrefix('aws.example.com', '')).toBe('example-com');
    });

    it('reserved word "amazon": is stripped and replaced with hyphen', () => {
      expect(deriveCognitoDomainPrefix('amazon.example.com', '')).toBe('example-com');
    });

    it('reserved word "cognito": is stripped and replaced with hyphen', () => {
      expect(deriveCognitoDomainPrefix('cognito.example.com', '')).toBe('example-com');
    });

    it('reserved words combined: all are stripped', () => {
      expect(deriveCognitoDomainPrefix('aws.amazon.cognito.com', '')).toBe('com');
    });

    it('reserved word as substring: "aws-mail.com" contains full "aws" substring', () => {
      // This demonstrates substring matching (not word-boundary aware)
      // "aws" is replaced with "-", then leading hyphen is trimmed
      expect(deriveCognitoDomainPrefix('aws-mail.com', '')).toBe('mail-com');
    });

    it('reserved word NOT as substring: "aweso-mail.com" does NOT trigger "aws"', () => {
      // "awesome" does not contain "aws" as a substring (it's a-w-e, not a-w-s)
      expect(deriveCognitoDomainPrefix('aweso-mail.com', '')).toBe('aweso-mail-com');
    });

    it('truncation at 63 chars: no trailing hyphen survives', () => {
      // Create a string that will be exactly 63 chars and end with a hyphen before truncation
      const longDomain = 'a'.repeat(62) + '.com'; // 66 chars
      const result = deriveCognitoDomainPrefix(longDomain, '');
      expect(result.length).toBeLessThanOrEqual(63);
      expect(result).not.toMatch(/-$/);
    });

    it('truncation boundary: 63-char limit with no trailing hyphen', () => {
      // Construct a domain that yields exactly 63 chars, then would add a hyphen
      const domain = 'a'.repeat(60) + '-b.com'; // After processing: 'a' * 60 + '-b-com' = 66 chars
      const result = deriveCognitoDomainPrefix(domain, '');
      expect(result.length).toBeLessThanOrEqual(63);
      expect(result).not.toMatch(/-$/);
    });

    it('empty after strip: falls back to provided fallback', () => {
      expect(deriveCognitoDomainPrefix('aws.amazon.cognito', 'my-stack')).toBe('my-stack');
    });

    it('empty after strip: fallback is itself sanitized', () => {
      // If the fallback also contains reserved words, it's sanitized
      expect(deriveCognitoDomainPrefix('aws', 'aws-backup')).toBe('backup');
    });

    it('double fallback empty: final literal "installer" is returned', () => {
      // If both primary and fallback strip to nothing, return 'installer'
      expect(deriveCognitoDomainPrefix('aws.amazon.cognito', '')).toBe('installer');
    });

    it('uppercase reserved words: case-insensitive matching', () => {
      expect(deriveCognitoDomainPrefix('AWS.EXAMPLE.COM', '')).toBe('example-com');
      expect(deriveCognitoDomainPrefix('Amazon.Example.Com', '')).toBe('example-com');
      expect(deriveCognitoDomainPrefix('COGNITO.example.com', '')).toBe('example-com');
    });

    it('leading/trailing hyphens: are trimmed', () => {
      const result = deriveCognitoDomainPrefix('-example.com-', '');
      expect(result).not.toMatch(/^-/);
      expect(result).not.toMatch(/-$/);
      expect(result).toBe('example-com');
    });

    it('repeated hyphens after reserved-word stripping: are collapsed', () => {
      // "my-aws-backup.com" → "my-aws-backup-com" → "my---backup-com" (aws replaced with -) → "my-backup-com"
      expect(deriveCognitoDomainPrefix('my-aws-backup.com', '')).toBe('my-backup-com');
    });

    it('special characters (beyond dots): are replaced with hyphens', () => {
      expect(deriveCognitoDomainPrefix('example_com@test', '')).toBe('example-com-test');
    });

    // Fallback-property behavior test cases
    it('Fallback behavior: explicit fallback wins when primary domain is empty', () => {
      expect(deriveCognitoDomainPrefix('', 'my-fallback')).toBe('my-fallback');
    });

    it('Fallback behavior: explicit fallback is used when primary domain strips to empty', () => {
      expect(deriveCognitoDomainPrefix('aws.amazon', 'backup-name')).toBe('backup-name');
    });

    it('Fallback behavior: ultimate fallback is "installer" when both primary and fallback strip to empty', () => {
      expect(deriveCognitoDomainPrefix('aws', '')).toBe('installer');
      expect(deriveCognitoDomainPrefix('cognito.amazon', '')).toBe('installer');
    });
  });

  describe('sanitizeStackName', () => {
    it('normal stack name: mixed case is lowercased', () => {
      expect(sanitizeStackName('MyStack')).toBe('mystack');
    });

    it('dots are replaced with hyphens', () => {
      expect(sanitizeStackName('my.stack.name')).toBe('my-stack-name');
    });

    it('special characters: are replaced with hyphens', () => {
      expect(sanitizeStackName('my_stack@name!')).toBe('my-stack-name');
    });

    it('repeated hyphens: are collapsed', () => {
      expect(sanitizeStackName('my--stack---name')).toBe('my-stack-name');
    });

    it('leading/trailing hyphens: are trimmed', () => {
      expect(sanitizeStackName('-my-stack-')).toBe('my-stack');
    });

    it('40-char truncation: result is at most 40 chars', () => {
      const longName = 'a'.repeat(50);
      const result = sanitizeStackName(longName);
      expect(result.length).toBeLessThanOrEqual(40);
    });

    it('empty input: returns empty string', () => {
      expect(sanitizeStackName('')).toBe('');
    });

    it('only special chars: results in hyphen(s) which are trimmed to empty', () => {
      expect(sanitizeStackName('___')).toBe('');
    });

    it('truncation at 40 chars does not remove final meaningful char', () => {
      const name = 'a'.repeat(41); // 41 'a's
      const result = sanitizeStackName(name);
      expect(result.length).toBe(40);
      expect(result).toBe('a'.repeat(40));
    });
  });
});
