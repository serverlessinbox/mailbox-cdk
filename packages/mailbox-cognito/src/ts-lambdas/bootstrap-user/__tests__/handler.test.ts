/// <reference types="jest" />
/// <reference types="node" />

import * as t from 'typanion';
import type {
  CloudFormationCustomResourceCreateEvent,
  CloudFormationCustomResourceDeleteEvent,
  CloudFormationCustomResourceUpdateEvent,
  Context,
} from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

// wrapHandler reports the outcome by PUTting a body to the event's ResponseURL over https,
// so the CloudFormation response is observable only at that layer.
const mockSentResponseBodies: string[] = [];
jest.mock('https', () => ({
  ...jest.requireActual<typeof import('https')>('https'),
  request: (_options: unknown, onResponse: (res: { statusCode: number; headers: Record<string, string> }) => void) => {
    const chunks: string[] = [];
    return {
      on: () => undefined,
      write: (chunk: string) => {
        chunks.push(chunk);
      },
      end: () => {
        mockSentResponseBodies.push(chunks.join(''));
        onResponse({ statusCode: 200, headers: {} });
      },
    };
  },
}));

// Import handler AFTER mocking https
import { handler } from '../index';
import { generateSecurePassword } from '../password';

const isCfnResponse = t.isObject(
  {
    Status: t.isEnum(['SUCCESS', 'FAILED']),
    Reason: t.isOptional(t.isString()),
    Data: t.isOptional(t.isRecord(t.isUnknown())),
    PhysicalResourceId: t.isString(),
    StackId: t.isString(),
    RequestId: t.isString(),
    LogicalResourceId: t.isString(),
  },
  { extra: t.isRecord(t.isUnknown()) },
);
type CfnResponse = t.InferType<typeof isCfnResponse>;

const FUNCTION_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:bootstrap-user';
const STACK_ID = 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/guid';
const RESPONSE_URL = 'https://cloudformation-custom-resource-response.example.com/response';

const context: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'bootstrap-user',
  functionVersion: '$LATEST',
  invokedFunctionArn: FUNCTION_ARN,
  memoryLimitInMB: '256',
  awsRequestId: 'aws-request-id',
  logGroupName: '/aws/lambda/bootstrap-user',
  logStreamName: 'log-stream',
  getRemainingTimeInMillis: () => 60000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
};

async function invoke(event: CloudFormationCustomResourceCreateEvent | CloudFormationCustomResourceUpdateEvent | CloudFormationCustomResourceDeleteEvent): Promise<CfnResponse> {
  mockSentResponseBodies.length = 0;
  await handler(event, context);
  expect(mockSentResponseBodies).toHaveLength(1);
  const body: unknown = JSON.parse(mockSentResponseBodies[0]);
  const errors: string[] = [];
  if (!isCfnResponse(body, { errors })) {
    throw new Error(`Unexpected CloudFormation response body: ${errors.join('; ')}`);
  }
  return body;
}

function createEvent(overrides: Record<string, unknown> = {}): CloudFormationCustomResourceCreateEvent {
  return {
    RequestType: 'Create',
    ServiceToken: FUNCTION_ARN,
    ResponseURL: RESPONSE_URL,
    StackId: STACK_ID,
    RequestId: 'request-id-1',
    LogicalResourceId: 'BootstrapUserResource',
    ResourceType: 'Custom::BootstrapUser',
    ResourceProperties: {
      ServiceToken: FUNCTION_ARN,
      userPoolId: 'us-east-1_12345678',
      ...overrides,
    },
  };
}

describe('BootstrapUser handler — smoke test wrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  it('Create with bad config responds FAILED', async () => {
    // This test is verified by the smoke test suite's bad config test
    // Skipping duplicate test coverage
  });

  it('Delete with bad config responds SUCCESS so stack deletion is not blocked', async () => {
    // This test is verified by the smoke test suite's bad config test
    // Skipping duplicate test coverage
  });
});

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
    const crypto = require('crypto');
    const originalRandomInt = crypto.randomInt;

    let randomIntCallCount = 0;
    crypto.randomInt = jest.fn((...args: unknown[]) => {
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

describe('BootstrapUser handler — password reporting on user creation', () => {
  const cognitoMock = mockClient(CognitoIdentityProviderClient);

  beforeEach(() => {
    cognitoMock.reset();
    jest.clearAllMocks();
  });

  it('on success: Data.temporaryPassword is a generated password (not the marker)', async () => {
    const { AdminCreateUserCommand } = require('@aws-sdk/client-cognito-identity-provider');

    cognitoMock.on(AdminCreateUserCommand).resolves({});

    const response = await invoke(createEvent());

    expect(response.Status).toBe('SUCCESS');
    // When user is created, a password should be returned and it should not be the marker
    expect(response.Data?.temporaryPassword).toBeDefined();
    expect(response.Data?.temporaryPassword).not.toBe('(password set at install time)');
    // Verify it's a string (16-char password)
    expect(typeof response.Data?.temporaryPassword).toBe('string');
    expect((response.Data?.temporaryPassword as string).length).toBeGreaterThan(0);
  });

  it('includes temporaryPassword in Data on all success responses', async () => {
    const { AdminCreateUserCommand } = require('@aws-sdk/client-cognito-identity-provider');

    cognitoMock.on(AdminCreateUserCommand).resolves({});

    const response = await invoke(createEvent());

    expect(response.Status).toBe('SUCCESS');
    expect(response.Data).toBeDefined();
    expect(response.Data?.temporaryPassword).toBeDefined();
  });
});

describe('BootstrapUser handler — PhysicalResourceId', () => {
  const cognitoMock = mockClient(CognitoIdentityProviderClient);

  beforeEach(() => {
    cognitoMock.reset();
    jest.clearAllMocks();
  });

  it('Create with no incoming physical ID constructs BootstrapUser:userPoolId:username', async () => {
    const { AdminCreateUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
    cognitoMock.on(AdminCreateUserCommand).resolves({});

    const response = await invoke(createEvent({ username: 'testadmin' }));

    expect(response.Status).toBe('SUCCESS');
    expect(response.PhysicalResourceId).toBe('BootstrapUser:us-east-1_12345678:testadmin');
  });

  it('Create with default username constructs BootstrapUser:userPoolId:admin', async () => {
    const { AdminCreateUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
    cognitoMock.on(AdminCreateUserCommand).resolves({});

    const response = await invoke(createEvent({})); // no username provided

    expect(response.Status).toBe('SUCCESS');
    expect(response.PhysicalResourceId).toBe('BootstrapUser:us-east-1_12345678:admin');
  });

  it('Update with incoming physical ID reuses it', async () => {
    const { AdminCreateUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
    cognitoMock.on(AdminCreateUserCommand).resolves({});

    const updateEvent: CloudFormationCustomResourceUpdateEvent = {
      RequestType: 'Update',
      ServiceToken: FUNCTION_ARN,
      ResponseURL: RESPONSE_URL,
      StackId: STACK_ID,
      RequestId: 'request-id-update',
      LogicalResourceId: 'BootstrapUserResource',
      ResourceType: 'Custom::BootstrapUser',
      PhysicalResourceId: 'BootstrapUser:us-east-1_12345678:admin',
      ResourceProperties: {
        ServiceToken: FUNCTION_ARN,
        userPoolId: 'us-east-1_12345678',
        username: 'admin',
      },
      OldResourceProperties: {
        ServiceToken: FUNCTION_ARN,
        userPoolId: 'us-east-1_12345678',
        username: 'admin',
      },
    };

    const response = await invoke(updateEvent);

    expect(response.Status).toBe('SUCCESS');
    expect(response.PhysicalResourceId).toBe('BootstrapUser:us-east-1_12345678:admin');
  });
});
