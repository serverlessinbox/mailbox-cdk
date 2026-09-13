/// <reference types="jest" />

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
