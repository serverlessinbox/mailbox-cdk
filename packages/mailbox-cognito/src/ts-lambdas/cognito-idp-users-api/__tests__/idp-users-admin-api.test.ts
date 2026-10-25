/// <reference types="jest" />

/**
 * Pins how the IdP users API wires its parts into the admin API pipeline: each method is validated by its own
 * validator, the groups from the configuration decide the roles of the caller, and the audit event names the
 * caller as its actor. The service, the validator and the audit queue are each tested on their own; a swapped
 * validator or a dropped group list is wrong only in this wiring, and nothing else would notice.
 */

import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { create }                        from '@bufbuild/protobuf';
import type { ApiGatewayV2EventLike }    from '@serverlessinbox/mailbox-addon-sdk';
import { toQueueUrl }                    from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                    from 'aws-sdk-client-mock';

import { toGroupName, type GroupName }   from '../../../runtime/shared/cognito-identifiers';
import { DeleteIdpUserResponseSchema }   from '../generated/idp_users_pb';
import { IdpUsersAdminApi }              from '../idp-users-admin-api';
import { IdpUsersRequestValidator }      from '../idp-users.validation';
import { SqsAuditEmitter }               from '../sqs-audit-emitter';

const QUEUE_URL = toQueueUrl('https://sqs.us-east-1.amazonaws.com/123456789012/audit-events');

function event(method: string, body: unknown, authorizer: Record<string, unknown> = { sub: 'sub-1' }): ApiGatewayV2EventLike {
  return {
    rawPath:        `/idp-users/IdpUsersService/${method}`,
    body:           JSON.stringify(body),
    requestContext: { requestId: 'req-1', http: { method: 'POST' }, authorizer: { lambda: authorizer } },
  };
}

describe('IdpUsersAdminApi', () => {
  const sqsMock = mockClient(SQSClient);
  const service = {
    listIdpUsers:       jest.fn(),
    getIdpUser:         jest.fn(),
    createIdpUser:      jest.fn(),
    setIdpUserEnabled:  jest.fn(),
    setIdpUserPassword: jest.fn(),
    deleteIdpUser:      jest.fn(),
  };

  function newApi(adminGroups?: GroupName[], userGroups?: GroupName[]): IdpUsersAdminApi {
    return new IdpUsersAdminApi(service, new IdpUsersRequestValidator(), new SqsAuditEmitter(QUEUE_URL, new SQSClient({})), adminGroups, userGroups);
  }

  function auditMessage(): unknown {
    return JSON.parse(sqsMock.commandCalls(SendMessageCommand)[0].args[0].input.MessageBody ?? '');
  }

  beforeEach(() => {
    sqsMock.reset();
    sqsMock.on(SendMessageCommand).resolves({});
    Object.values(service).forEach((method) => method.mockReset());
    service.deleteIdpUser.mockResolvedValue(create(DeleteIdpUserResponseSchema, {}));
  });

  it('answers a request with the response of the service method it names', async () => {
    const result = await newApi().handle(event('DeleteIdpUser', { username: 'alice' }));

    expect(result.statusCode).toBe(200);
    expect(service.deleteIdpUser).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ username: 'alice' }));
  });

  it.each([
    { method: 'ListIdpUsers', body: { pageSize: 0 }, message: 'pageSize must be an integer between 1 and 1000' },
    { method: 'GetIdpUser', body: {}, message: 'Missing/invalid username' },
    { method: 'CreateIdpUser', body: { username: 'alice', password: 'short' }, message: 'Missing/invalid password' },
    { method: 'SetIdpUserEnabled', body: {}, message: 'Missing/invalid username' },
    { method: 'SetIdpUserPassword', body: { username: 'alice', password: 'short' }, message: 'Missing/invalid password' },
    { method: 'DeleteIdpUser', body: {}, message: 'Missing/invalid username' },
  ])('rejects an invalid $method request with the message of the rule it breaks, without calling the service', async ({ method, body, message }) => {
    const result = await newApi().handle(event(method, body));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body ?? '')).toEqual({ error: { message } });
    expect(Object.values(service).every((serviceMethod) => serviceMethod.mock.calls.length === 0)).toBe(true);
  });

  it('gives the caller the roles of the configured groups', async () => {
    const api = newApi([toGroupName('staff')], [toGroupName('member')]);

    await api.handle(event('DeleteIdpUser', { username: 'alice' }, { sub: 'sub-1', 'cognito:groups': ['Staff'] }));
    await api.handle(event('DeleteIdpUser', { username: 'alice' }, { sub: 'sub-2', 'cognito:groups': ['member'] }));

    const callers = service.deleteIdpUser.mock.calls.map(([ctx]: Array<{ auth: unknown }>) => ctx.auth);
    expect(callers).toMatchObject([
      { isAdmin: true, roles: ['admin'] },
      { isAdmin: false, roles: ['user'] },
    ]);
  });

  it('names the signed-in caller and its tenant on the audit event of a write', async () => {
    const authorizer = {
      sub:              'sub-1',
      iss:              'https://issuer.example.com',
      username:         'admin',
      email:            'admin@example.com',
      tenantId:         'tenant-1',
      'cognito:groups': ['admin'],
      scope:            'openid profile',
    };

    await newApi().handle(event('DeleteIdpUser', { username: 'alice' }, authorizer));

    expect(auditMessage()).toMatchObject({
      tenantId: 'tenant-1',
      actor:    {
        actorType: 'user',
        actorId:   'sub-1',
        username:  'admin',
        iss:       'https://issuer.example.com',
        email:     'admin@example.com',
        groups:    ['admin'],
        scopes:    ['openid', 'profile'],
      },
    });
  });

  it('names the system as the actor of a request without a subject', async () => {
    await newApi().handle(event('DeleteIdpUser', { username: 'alice' }, {}));

    expect(auditMessage()).toMatchObject({ actor: { actorType: 'system', actorId: 'unknown', username: 'unknown' } });
  });
});
