/// <reference types="jest" />

/**
 * Pins the entry wiring of the IdP users API Lambda: an incomplete environment stops the cold start, the health
 * probe reflects the environment it is asked in, and a real event reaches the service of the path it names and is
 * answered in the form the generated client reads. Without the first, the Lambda starts and fails every request;
 * without the second, the auto-updater would keep code that cannot run; without the third, the admin UI would
 * fail on an answer it cannot decode, or an admin action would leave no audit entry.
 *
 * The environment is read when the handler module loads, so it is set before the module is imported.
 */

const MANDATORY_VARIABLES = ['USER_POOL_ID', 'AUDIT_EVENTS_QUEUE_URL', 'IDENTITY_PROVISIONER_FUNCTION_NAME'];

function setValidEnvironment(): void {
  process.env.USER_POOL_ID                       = 'pool-1';
  process.env.AUDIT_EVENTS_QUEUE_URL             = 'https://sqs.us-east-1.amazonaws.com/123456789012/audit-events';
  process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'identity-provisioner';
  process.env.ADMIN_GROUPS                       = JSON.stringify(['admin']);
}

setValidEnvironment();

import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { InvokeCommand, LambdaClient }                                      from '@aws-sdk/client-lambda';
import { SendMessageCommand, SQSClient }                                    from '@aws-sdk/client-sqs';
import { fromJsonString, type DescMessage }                                 from '@bufbuild/protobuf';
import * as lambdaRuntime                                                   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { APIGatewayProxyStructuredResultV2 }                           from 'aws-lambda';
import { mockClient }                                                       from 'aws-sdk-client-mock';
import * as t                                                               from 'typanion';

import {
  CreateIdpUserResponseSchema,
  DeleteIdpUserResponseSchema,
  GetIdpUserResponseSchema,
  ListIdpUsersResponseSchema,
  SetIdpUserEnabledResponseSchema,
  SetIdpUserPasswordResponseSchema,
} from '../generated/idp_users_pb';
import { handler }                                                      from '../handler';

import { authorizedEvent, payloadOf }                                   from './idp-users-helpers';

const isSentAuditMessage = t.isPartial({ action: t.isString(), status: t.isString(), entityId: t.isString() });
/** The part of an audit event that these tests read from the message the Lambda sent. */
type SentAuditMessage = t.InferType<typeof isSentAuditMessage>;

interface ServicePath {
  readonly method:   string;
  readonly request:  object;
  readonly response: DescMessage;
  readonly audited:  boolean;
}

const SERVICE_PATHS: ServicePath[] = [
  { method: 'ListIdpUsers', request: { pageSize: 10 }, response: ListIdpUsersResponseSchema, audited: false },
  { method: 'GetIdpUser', request: { username: 'alice' }, response: GetIdpUserResponseSchema, audited: false },
  { method: 'CreateIdpUser', request: { username: 'alice', password: 'Passw0rd!' }, response: CreateIdpUserResponseSchema, audited: true },
  { method: 'SetIdpUserEnabled', request: { username: 'alice', enabled: true }, response: SetIdpUserEnabledResponseSchema, audited: true },
  { method: 'SetIdpUserPassword', request: { username: 'alice', password: 'Passw0rd!' }, response: SetIdpUserPasswordResponseSchema, audited: true },
  { method: 'DeleteIdpUser', request: { username: 'alice' }, response: DeleteIdpUserResponseSchema, audited: true },
];

async function answerOf(event: ReturnType<typeof authorizedEvent>): Promise<APIGatewayProxyStructuredResultV2> {
  const answer = await handler(event);
  if (!('statusCode' in answer)) {
    throw new Error('expected an HTTP answer, not a health probe answer');
  }
  return answer;
}

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

  function auditMessages(): SentAuditMessage[] {
    return sqsMock.commandCalls(SendMessageCommand).map((call) => {
      const message: unknown = JSON.parse(call.args[0].input.MessageBody ?? '');
      const errors: string[] = [];
      if (!isSentAuditMessage(message, { errors })) {
        throw new Error(`the audit message is not shaped as expected: ${errors.join('; ')}`);
      }
      return message;
    });
  }

  it('answers a health probe as healthy when the environment is complete', async () => {
    const probe: lambdaRuntime.SmokeTestProbe = { serverlessInboxSmokeTest: true };

    expect(await handler(probe)).toEqual({ serverlessInboxSmokeTestOk: true });
  });

  it('answers a health probe as unhealthy when a variable of the environment is gone', async () => {
    delete process.env.USER_POOL_ID;
    const probe: lambdaRuntime.SmokeTestProbe = { serverlessInboxSmokeTest: true };

    expect(await handler(probe)).toEqual({ serverlessInboxSmokeTestOk: false });
  });

  describe('a request for a method of the service', () => {
    it.each(SERVICE_PATHS)('$method answers 200 with a body the generated client decodes', async ({ method, request, response }) => {
      const answer = await answerOf(authorizedEvent(`/idp-users/${method}`, request));

      expect(answer.statusCode).toBe(200);
      expect(() => fromJsonString(response, String(answer.body))).not.toThrow();
    });

    it.each(SERVICE_PATHS)('$method sends the audit entry of a change, and none for a read', async ({ method, request, audited }) => {
      await answerOf(authorizedEvent(`/idp-users/${method}`, request));

      expect(auditMessages()).toEqual(audited ? [expect.objectContaining({ action: `IdpUsersService/${method}`, status: 'success', entityId: 'alice' })] : []);
    });
  });

  describe('a change that Cognito refuses', () => {
    it.each([
      { method: 'CreateIdpUser', request: { username: 'alice', password: 'Passw0rd!' }, refuse: () => cognitoMock.on(AdminCreateUserCommand).rejects(Object.assign(new Error('exists'), { name: 'UsernameExistsException' })), status: 409 },
      { method: 'SetIdpUserEnabled', request: { username: 'alice', enabled: false }, refuse: () => cognitoMock.on(AdminDisableUserCommand).rejects(Object.assign(new Error('gone'), { name: 'UserNotFoundException' })), status: 404 },
      { method: 'SetIdpUserPassword', request: { username: 'alice', password: 'Passw0rd!' }, refuse: () => cognitoMock.on(AdminSetUserPasswordCommand).rejects(Object.assign(new Error('weak'), { name: 'InvalidPasswordException' })), status: 400 },
      { method: 'DeleteIdpUser', request: { username: 'alice' }, refuse: () => cognitoMock.on(AdminDeleteUserCommand).rejects(Object.assign(new Error('Cognito down'), { name: 'ServiceUnavailableException' })), status: 500 },
    ])('$method answers $status and sends one failure audit entry', async ({ method, request, refuse, status }) => {
      refuse();

      const answer = await answerOf(authorizedEvent(`/idp-users/${method}`, request));

      expect(answer.statusCode).toBe(status);
      expect(auditMessages()).toEqual([expect.objectContaining({ action: `IdpUsersService/${method}`, status: 'failure', entityId: 'alice' })]);
    });

    it('answers an invalid request as plain text 400, without calling Cognito or sending an audit entry', async () => {
      const answer = await answerOf(authorizedEvent('/idp-users/SetIdpUserEnabled', { username: '  ', enabled: true }));

      expect(answer).toMatchObject({ statusCode: 400, body: 'Missing/invalid username' });
      expect(cognitoMock.commandCalls(AdminEnableUserCommand)).toHaveLength(0);
      expect(auditMessages()).toEqual([]);
    });
  });

  it('answers 404 for a method the service does not have', async () => {
    const answer = await answerOf(authorizedEvent('/idp-users/DropAllUsers', {}));

    expect(answer.statusCode).toBe(404);
  });

  it('answers 401 for a request without a principal, and does not reach Cognito', async () => {
    const answer = await answerOf(authorizedEvent('/idp-users/ListIdpUsers', {}, { tenantId: 'tenant-1' }));

    expect(answer.statusCode).toBe(401);
    expect(cognitoMock.calls()).toHaveLength(0);
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
