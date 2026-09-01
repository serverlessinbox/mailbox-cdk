/// <reference types="jest" />

/**
 * Smoke test for cognito-idp-users-api handler.
 *
 * Environment variables are validated at module load time, so they must be set
 * before importing the handler. This test suite sets the required vars before import.
 */

// Set up environment variables before importing the handler
process.env.USER_POOL_ID = 'pool-1';
process.env.AUDIT_EVENTS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/audit-events';
process.env.ADMIN_GROUPS = JSON.stringify(['admin']);
process.env.USER_GROUPS = JSON.stringify(['user']);

import { CognitoIdentityProviderClient, AdminCreateUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { SmokeTestProbe } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { handler } from '../index';

describe('CognitoIdpUsersApi handler — smoke test wrapper', () => {
  const cognitoMock = mockClient(CognitoIdentityProviderClient);

  beforeEach(() => {
    cognitoMock.reset();
  });

  it('responds to smoke test probe without invoking the real handler', async () => {
    const probeEvent: SmokeTestProbe = { serverlessInboxSmokeTest: true };
    const result = await handler(probeEvent);

    expect(result).toEqual({ serverlessInboxSmokeTestOk: true });

    // Verify no Cognito operations were invoked — zero AdminCreateUserCommand (and any other command)
    expect(cognitoMock.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });
});
