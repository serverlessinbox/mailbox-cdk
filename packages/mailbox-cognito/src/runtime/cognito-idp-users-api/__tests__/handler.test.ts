/// <reference types="jest" />

/**
 * Pins the entry wiring of the IdP users API Lambda: an incomplete environment stops the cold start, the health
 * probe reflects the environment it is asked in, and the values of the environment reach the clients that use
 * them. Without the first, the Lambda starts and fails every request; without the second, the auto-updater would
 * keep code that cannot run; without the third, the Lambda would manage the wrong pool or send its audit entries
 * nowhere.
 *
 * The environment is read when the handler module loads, so it is set before the module is imported.
 */

const MANDATORY_VARIABLES = ['USER_POOL_ID', 'AUDIT_EVENTS_QUEUE_URL', 'IDENTITY_PROVISIONER_FUNCTION_NAME'];

const USER_POOL_ID           = 'pool-1';
const AUDIT_EVENTS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/audit-events';
const IDENTITY_PROVISIONER   = 'identity-provisioner';

function setValidEnvironment(): void {
  process.env.USER_POOL_ID                       = USER_POOL_ID;
  process.env.AUDIT_EVENTS_QUEUE_URL             = AUDIT_EVENTS_QUEUE_URL;
  process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = IDENTITY_PROVISIONER;
  process.env.ADMIN_GROUPS                       = JSON.stringify(['admin']);
}

setValidEnvironment();

import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { InvokeCommand, LambdaClient }          from '@aws-sdk/client-lambda';
import { SendMessageCommand, SQSClient }        from '@aws-sdk/client-sqs';
import * as lambdaRuntime                       from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                           from 'aws-sdk-client-mock';

import { handler }                              from '../handler';

import { authorizedEvent, payloadOf }           from './idp-users-helpers';

describe('IdP users API handler', () => {
  const cognitoMock = mockClient(CognitoIdentityProviderClient);
  const lambdaMock  = mockClient(LambdaClient);
  const sqsMock     = mockClient(SQSClient);

  beforeEach(() => {
    cognitoMock.reset();
    cognitoMock.onAnyCommand().resolves({});
    cognitoMock.on(AdminGetUserCommand).resolves({ Username: 'alice', Enabled: true, UserAttributes: [{ Name: 'sub', Value: 'sub-1' }] });
    cognitoMock.on(ListUsersCommand).resolves({ Users: [{ Username: 'alice', Enabled: true }] });
    lambdaMock.reset();
    lambdaMock.on(InvokeCommand).resolves({ Payload: payloadOf({ principalId: 'principal-2', primaryAccountId: 'account-2', isNewUser: true }) });
    sqsMock.reset();
    sqsMock.on(SendMessageCommand).resolves({});
  });

  afterEach(() => {
    setValidEnvironment();
  });

  it('answers a health probe as healthy when the environment is complete', async () => {
    const probe: lambdaRuntime.SmokeTestProbe = { serverlessInboxSmokeTest: true };

    expect(await handler(probe)).toEqual({ serverlessInboxSmokeTestOk: true });
  });

  it('answers a health probe as unhealthy when a variable of the environment is gone', async () => {
    delete process.env.USER_POOL_ID;
    const probe: lambdaRuntime.SmokeTestProbe = { serverlessInboxSmokeTest: true };

    expect(await handler(probe)).toEqual({ serverlessInboxSmokeTestOk: false });
  });

  it('hands the pool, the audit queue and the identity provisioner of the environment to the clients that use them', async () => {
    await handler(authorizedEvent('/idp-users/CreateIdpUser', { username: 'alice', password: 'Passw0rd!' }));

    expect(cognitoMock.commandCalls(AdminCreateUserCommand)[0].args[0].input.UserPoolId).toBe(USER_POOL_ID);
    expect(lambdaMock.commandCalls(InvokeCommand)[0].args[0].input.FunctionName).toBe(IDENTITY_PROVISIONER);
    expect(sqsMock.commandCalls(SendMessageCommand)[0].args[0].input.QueueUrl).toBe(AUDIT_EVENTS_QUEUE_URL);
  });

  it('builds its logger with the configured service name and log level', () => {
    const actualRuntime = jest.requireActual<typeof lambdaRuntime>('@serverlessinbox/mailbox-cdk-shared/lambda-runtime');
    const loggerBuffer  = jest.fn((...args: ConstructorParameters<typeof lambdaRuntime.LoggerBuffer>) => new actualRuntime.LoggerBuffer(...args));
    const saved         = { ...process.env };
    try {
      process.env.SERVICE_NAME = 'cognito-idp-users-api';
      process.env.LOG_LEVEL    = 'warn';
      jest.isolateModules(() => {
        jest.doMock('@serverlessinbox/mailbox-cdk-shared/lambda-runtime', () => ({ ...actualRuntime, LoggerBuffer: loggerBuffer }));
        require('../handler');
      });
    } finally {
      process.env = saved;
    }

    expect(loggerBuffer).toHaveBeenCalledWith('cognito-idp-users-api', 'warn');
  });

  it.each(MANDATORY_VARIABLES)('stops the cold start, naming %s, when it is missing', (variable) => {
    const saved = { ...process.env };
    try {
      jest.isolateModules(() => {
        delete process.env[variable];

        expect(() => {
          require('../handler');
        }).toThrow(variable);
      });
    } finally {
      process.env = saved;
    }
  });
});
