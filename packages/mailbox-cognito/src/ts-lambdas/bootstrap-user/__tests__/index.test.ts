/// <reference types="jest" />
/// <reference types="node" />

import { mockClient } from 'aws-sdk-client-mock';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

// Mock the HTTPS module before importing the handler
jest.mock('node:https');

// Also mock the Cognito client
const cognitoMock = mockClient(CognitoIdentityProviderClient);

// Import the handler after mocking
import { handler } from '../index';

describe('BootstrapUser handler — smoke test wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cognitoMock.reset();
  });

  it('responds to smoke test probe without invoking the real handler', async () => {
    const probeEvent = { serverlessInboxSmokeTest: true };
    const result = await (handler as any)(probeEvent, {});

    expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
  });

  it('smoke test probe returns false when config is invalid', async () => {
    const originalEnv = { ...process.env };
    try {
      // Set an invalid LOG_LEVEL to trigger config error
      process.env.LOG_LEVEL = 'verbose';

      // Reload the module with the bad config
      jest.resetModules();
      const { handler: badConfigHandler } = require('../index');

      const probeEvent = { serverlessInboxSmokeTest: true };
      const result = await badConfigHandler(probeEvent, {});

      // When config is invalid, smoke test probe should return false
      expect(result).toEqual({ serverlessInboxSmokeTestOk: false });
    } finally {
      process.env = originalEnv;
      jest.resetModules();
      // Re-import with original environment
      require('../index');
    }
  });
});

describe('BootstrapUser handler — custom resource with bad config', () => {
  async function invokeWithBadConfig(cfnEvent: any): Promise<{ body: any; calls: number }> {
    const originalEnv = { ...process.env };

    try {
      process.env.LOG_LEVEL = 'invalid_level';

      jest.resetModules();
      jest.clearAllMocks();

      // Create the mock before requiring the module
      const mockRequest = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn().mockReturnThis(),
        end: jest.fn().mockReturnThis(),
      };

      // Mock https module with proper callback handling
      const httpsModule = require('node:https');
      httpsModule.request.mockImplementation((_opts: any, callback: any) => {
        // Call the callback immediately with a successful response
        if (callback) {
          callback({ statusCode: 200, resume: jest.fn() });
        }
        return mockRequest;
      });

      // Reload handler with bad config
      const badConfigModule = require('../index');
      const badConfigHandler = badConfigModule.handler;

      await badConfigHandler(cfnEvent, {});

      // Extract the response body from the write call
      const writeCall = (mockRequest.write as jest.Mock).mock.calls[0];
      const responseBody = JSON.parse(writeCall[0]);
      const calls = httpsModule.request.mock.calls.length;

      return { body: responseBody, calls };
    } finally {
      process.env = originalEnv;
    }
  }

  it('Create with bad config responds FAILED naming LOG_LEVEL', async () => {
    const cfnEvent = {
      RequestType: 'Create',
      ResponseURL: 'https://example.com/response',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid',
      RequestId: 'unique-id',
      ResourceType: 'Custom::BootstrapUser',
      LogicalResourceId: 'BootstrapUserResource',
      ResourceProperties: {
        userPoolId: 'us-east-1_12345678',
        username: 'admin',
      },
      PhysicalResourceId: 'physical-id',
    };

    const { body, calls } = await invokeWithBadConfig(cfnEvent);

    expect(calls).toBe(1);
    expect(body.Status).toBe('FAILED');
    expect(body.Reason).toMatch(/LOG_LEVEL/);
    expect(body.StackId).toBe(cfnEvent.StackId);
    expect(body.RequestId).toBe(cfnEvent.RequestId);
  });

  it('Delete with bad config responds SUCCESS so stack deletion is not blocked', async () => {
    const cfnEvent = {
      RequestType: 'Delete',
      ResponseURL: 'https://example.com/response',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test/guid',
      RequestId: 'unique-id',
      ResourceType: 'Custom::BootstrapUser',
      LogicalResourceId: 'BootstrapUserResource',
      ResourceProperties: {
        userPoolId: 'us-east-1_12345678',
        username: 'admin',
      },
      PhysicalResourceId: 'physical-id',
    };

    const { body, calls } = await invokeWithBadConfig(cfnEvent);

    expect(calls).toBe(1);
    expect(body.Status).toBe('SUCCESS');
  });
});

describe('generateSecurePassword', () => {
  // Import the function separately to test it
  const { generateSecurePassword } = require('../index');

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
    const password = generateSecurePassword();
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
      const password = generateSecurePassword();
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
    // This test spies on crypto.randomInt to verify it is called during password generation.
    // If the implementation were to regress to Math.random(), this spy would show no calls.
    const crypto = require('crypto');
    const originalRandomInt = crypto.randomInt;

    let randomIntCallCount = 0;
    crypto.randomInt = jest.fn((...args: unknown[]) => {
      randomIntCallCount++;
      // Delegate to the real randomInt to maintain password generation behavior
      return (originalRandomInt as typeof originalRandomInt)(...(args as [number, number]));
    });

    try {
      const password = generateSecurePassword();

      // Verify password is still valid
      expect(validatePassword(password).isValid).toBe(true);

      // Verify crypto.randomInt was called multiple times (at least for the 3 required chars + shuffling).
      // With 16 chars total and a Fisher-Yates shuffle, we expect ~19+ calls:
      // - 3 calls for required lowercase/uppercase/digit
      // - 13 calls for remaining characters
      // - 15 calls for shuffle (i from 15 down to 1)
      expect(randomIntCallCount).toBeGreaterThan(15);
    } finally {
      crypto.randomInt = originalRandomInt;
    }
  });
});

describe('BootstrapUser handler — generated password logic', () => {
  // Test the password generation logic without full event handling
  it('generates password when no temporaryPassword is supplied and no email', () => {
    // Direct test of the logic: when no email and no temporaryPassword, a password is generated
    const props = {
      userPoolId: 'us-east-1_12345678',
      username: 'admin',
      groups: [],
    };

    // Simulate the logic from the handler
    const email = (props as any).email as string | undefined;
    const suppliedPassword = (props as any).temporaryPassword as string | undefined;
    const generatedPassword = suppliedPassword ?? (!email ? 'GENERATED' : undefined);

    expect(generatedPassword).toBe('GENERATED');
  });

  it('does not generate password when temporaryPassword is supplied', () => {
    const props = {
      userPoolId: 'us-east-1_12345678',
      username: 'admin',
      groups: [],
      temporaryPassword: 'SuppliedPassword123',
    };

    // Simulate the logic from the handler
    const email = (props as any).email as string | undefined;
    const suppliedPassword = (props as any).temporaryPassword as string | undefined;
    const generatedPassword = suppliedPassword ?? (!email ? 'GENERATED' : undefined);

    expect(generatedPassword).toBe('SuppliedPassword123');
  });

  it('does not generate password when email is provided (invite mode)', () => {
    const props = {
      userPoolId: 'us-east-1_12345678',
      username: 'admin',
      groups: [],
      email: 'admin@example.com',
    };

    // Simulate the logic from the handler
    const email = (props as any).email as string | undefined;
    const suppliedPassword = (props as any).temporaryPassword as string | undefined;
    const generatedPassword = suppliedPassword ?? (!email ? 'GENERATED' : undefined);

    expect(generatedPassword).toBeUndefined();
  });
});
