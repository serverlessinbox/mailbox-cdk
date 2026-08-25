/// <reference types="jest" />

import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import https from 'node:https';

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

    // Verify no Cognito operations were invoked
    expect(cognitoMock.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0);

    // Verify no HTTPS request was made to send CloudFormation response
    const httpsMock = https as jest.Mocked<typeof https>;
    expect(httpsMock.request).not.toHaveBeenCalled();
  });
});
