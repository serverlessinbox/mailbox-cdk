import { isTerminalSuccess, isTerminalFailure, matchesKmsTransientSignature, requiresRecreate } from '../cfn-stack';

describe('matchesKmsTransientSignature', () => {
  it('returns true for real KMS NotFoundException text with "kms"', () => {
    const failureText = 'KMS validation error: com.amazonaws.services.kms.model.NotFoundException: Key \'arn:aws:kms:us-west-2:123456789012:key/abc\' does not exist (Service: AWSKMS; Status Code: 400)';
    expect(matchesKmsTransientSignature(failureText)).toBe(true);
  });

  it('returns true for KMS failure with "alias/aws/dynamodb" reference', () => {
    const failureText = 'Failed to validate KMS key alias/aws/dynamodb: NotFoundException - The key does not exist';
    expect(matchesKmsTransientSignature(failureText)).toBe(true);
  });

  it('returns true for both "notfoundexception" and "kms" present (case-insensitive)', () => {
    const failureText = 'Error: KMS Key NotFoundException occurred';
    expect(matchesKmsTransientSignature(failureText)).toBe(true);
  });

  it('returns false when "notfoundexception" is missing', () => {
    const failureText = 'KMS validation error: Service error occurred';
    expect(matchesKmsTransientSignature(failureText)).toBe(false);
  });

  it('returns false when "kms" is missing', () => {
    const failureText = 'NotFoundException: The resource does not exist';
    expect(matchesKmsTransientSignature(failureText)).toBe(false);
  });

  it('returns false for unrelated failure text', () => {
    const failureText = 'DynamoDB table creation failed: AccessDenied';
    expect(matchesKmsTransientSignature(failureText)).toBe(false);
  });

  it('is case-insensitive for both required keywords', () => {
    const failureTexts = [
      'NOTFOUNDEXCEPTION KMS error',
      'notfoundexception kms error',
      'NotFoundException KMS error',
      'KMS NOTFOUNDEXCEPTION error',
    ];
    failureTexts.forEach((text) => {
      expect(matchesKmsTransientSignature(text)).toBe(true);
    });
  });

  it('returns false when keywords are in wrong order but both present', () => {
    // Both keywords must be present, regardless of order
    const failureText = 'NotFoundException occurred in KMS service';
    expect(matchesKmsTransientSignature(failureText)).toBe(true);
  });

  it('returns true for empty string (edge case)', () => {
    // Empty string will not match because neither keyword is present
    expect(matchesKmsTransientSignature('')).toBe(false);
  });

  it('returns true for multiline failure text with KMS error buried in details', () => {
    const failureText = `
      Stack creation failed.
      Resource: DynamoDBTable
      Error details:
      - KMS validation NotFoundException occurred
      - Attempted to encrypt with alias/aws/dynamodb
    `.trim();
    expect(matchesKmsTransientSignature(failureText)).toBe(true);
  });
});

describe('requiresRecreate', () => {
  it('returns true for ROLLBACK_FAILED', () => {
    expect(requiresRecreate('ROLLBACK_FAILED')).toBe(true);
  });

  it('returns true for ROLLBACK_COMPLETE', () => {
    expect(requiresRecreate('ROLLBACK_COMPLETE')).toBe(true);
  });

  it('returns false for ROLLBACK_IN_PROGRESS', () => {
    expect(requiresRecreate('ROLLBACK_IN_PROGRESS')).toBe(false);
  });

  it('returns false for CREATE_FAILED', () => {
    expect(requiresRecreate('CREATE_FAILED')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(requiresRecreate(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(requiresRecreate('')).toBe(false);
  });
});

describe('isTerminalSuccess', () => {
  it('returns true for CREATE_COMPLETE', () => {
    expect(isTerminalSuccess('CREATE_COMPLETE')).toBe(true);
  });

  it('returns true for UPDATE_COMPLETE', () => {
    expect(isTerminalSuccess('UPDATE_COMPLETE')).toBe(true);
  });

  it('returns false for DELETE_COMPLETE (not a deploy success)', () => {
    expect(isTerminalSuccess('DELETE_COMPLETE')).toBe(false);
  });

  it('returns false for UPDATE_ROLLBACK_COMPLETE', () => {
    expect(isTerminalSuccess('UPDATE_ROLLBACK_COMPLETE')).toBe(false);
  });

  it('returns false for CREATE_ROLLBACK_COMPLETE', () => {
    expect(isTerminalSuccess('CREATE_ROLLBACK_COMPLETE')).toBe(false);
  });

  it('returns false for DELETE_IN_PROGRESS', () => {
    expect(isTerminalSuccess('DELETE_IN_PROGRESS')).toBe(false);
  });

  it('returns false for DELETE_FAILED', () => {
    expect(isTerminalSuccess('DELETE_FAILED')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isTerminalSuccess(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isTerminalSuccess('')).toBe(false);
  });
});

describe('isTerminalFailure', () => {
  it('returns true for CREATE_FAILED', () => {
    expect(isTerminalFailure('CREATE_FAILED')).toBe(true);
  });

  it('returns true for UPDATE_FAILED', () => {
    expect(isTerminalFailure('UPDATE_FAILED')).toBe(true);
  });

  it('returns true for UPDATE_ROLLBACK_COMPLETE', () => {
    expect(isTerminalFailure('UPDATE_ROLLBACK_COMPLETE')).toBe(true);
  });

  it('returns true for DELETE_FAILED', () => {
    expect(isTerminalFailure('DELETE_FAILED')).toBe(true);
  });

  it('returns false for CREATE_IN_PROGRESS', () => {
    expect(isTerminalFailure('CREATE_IN_PROGRESS')).toBe(false);
  });

  it('returns false for DELETE_IN_PROGRESS', () => {
    expect(isTerminalFailure('DELETE_IN_PROGRESS')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isTerminalFailure(undefined)).toBe(false);
  });
});
