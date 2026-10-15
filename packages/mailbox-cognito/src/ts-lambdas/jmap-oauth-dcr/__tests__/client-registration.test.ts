/// <reference types="jest" />

/**
 * Pins how a registration request is answered and what it does in the user pool and in `identity-provisioner`.
 * The failure modes that matter are a client left in the pool that is not recorded, a tenant chosen by the
 * request instead of by `identity-provisioner`, a request that burns the tenant's cap before it is rejected, and a
 * Cognito failure that is reported to the client as a fault in its own request.
 */

import {
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  DeleteUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { LoggerBuffer, toFunctionName } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { toUserPoolId } from '../../shared/cognito-identifiers';
import { IdentityProvisionerClient } from '../../shared/identity-provisioner-client';
import { ClientRegistration } from '../client-registration';
import { CognitoUserPoolClientManager } from '../cognito-client';
import { PoolResolver } from '../pool-resolver';
import { RedirectUriPolicy } from '../redirect-uri';
import { bodyOf, mockIdentityProvisioner, rawRequestEvent, requestEvent, sentRequests } from './jmap-oauth-dcr-helpers';

const LOOPBACK_REDIRECT_URI = 'http://127.0.0.1/cb';

describe('ClientRegistration', () => {
  const lambdaMock = mockClient(LambdaClient);
  const cognitoMock = mockClient(CognitoIdentityProviderClient);

  let registration: ClientRegistration;
  let warnLog: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    lambdaMock.reset();
    cognitoMock.reset();
    cognitoMock.on(CreateUserPoolClientCommand).resolves({ UserPoolClient: { ClientId: 'new-client-id' } });
    cognitoMock.on(DeleteUserPoolClientCommand).resolves({});

    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    warnLog = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    registration = new ClientRegistration(
      new IdentityProvisionerClient(toFunctionName('identity-provisioner-fn'), new LambdaClient({})),
      new CognitoUserPoolClientManager(new CognitoIdentityProviderClient({})),
      new PoolResolver(toUserPoolId('pool-1')),
      new RedirectUriPolicy(),
      new LoggerBuffer(undefined, 'debug'),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('a request that proceeds', () => {
    it('creates a public client in the pool, records it, and answers 201 with the client information', async () => {
      mockIdentityProvisioner(lambdaMock, {});

      const answer = await registration.register(requestEvent({ redirect_uris: ['http://127.0.0.1:4321/cb'], client_name: 'My App' }));

      expect(answer.statusCode).toBe(201);
      expect(bodyOf(answer)).toMatchObject({
        client_id: 'new-client-id',
        client_id_issued_at: expect.any(Number),
        redirect_uris: ['http://127.0.0.1:4321/cb'],
        token_endpoint_auth_method: 'none',
        client_name: 'My App',
        scope: 'openid email profile',
      });
      expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(1);
      expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)[0].args[0].input).toMatchObject({
        UserPoolId: 'pool-1',
        ClientName: 'My App',
        GenerateSecret: false,
        CallbackURLs: ['http://127.0.0.1:4321/cb'],
      });
      expect(sentRequests(lambdaMock).map((request) => request.kind)).toEqual(['RESOLVE_TENANT', 'DCR_CHECK', 'DCR_PERSIST']);
      expect(sentRequests(lambdaMock)[2]).toMatchObject({ clientId: 'new-client-id', scope: 'openid email profile' });
    });

    it('reads a base64 encoded body', async () => {
      mockIdentityProvisioner(lambdaMock, {});
      const encoded = Buffer.from(JSON.stringify({ redirect_uris: [LOOPBACK_REDIRECT_URI] })).toString('base64');

      const answer = await registration.register(rawRequestEvent(encoded, true));

      expect(answer.statusCode).toBe(201);
    });

    it('registers the scopes it asks of Cognito, without offline_access, and answers with them', async () => {
      mockIdentityProvisioner(lambdaMock, {});

      const answer = await registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI], scope: 'openid offline_access' }));

      expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)[0].args[0].input.AllowedOAuthScopes).toEqual(['openid']);
      expect(bodyOf(answer)).toMatchObject({ scope: 'openid' });
    });

    // Cognito rejects a client that is allowed OAuth flows and has no allowed scopes, so a request that reduces
    // to no scope once offline_access is dropped must be granted the default scope.
    it.each([
      ['only offline_access', 'offline_access'],
      ['an empty string', ''],
      ['whitespace only', '   '],
    ])('grants the default scope when the request asks for %s', async (_label, scope) => {
      mockIdentityProvisioner(lambdaMock, {});

      const answer = await registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI], scope }));

      expect(answer.statusCode).toBe(201);
      expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)[0].args[0].input.AllowedOAuthScopes).toEqual(['openid', 'email', 'profile']);
      expect(bodyOf(answer)).toMatchObject({ scope: 'openid email profile' });
    });

    it.each([
      ['absent', undefined],
      ['empty after trimming', '   '],
    ])('names the client "Unnamed JMAP Client" when client_name is %s', async (_label, clientName) => {
      mockIdentityProvisioner(lambdaMock, {});

      const answer = await registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI], client_name: clientName }));

      expect(bodyOf(answer)).toMatchObject({ client_name: 'Unnamed JMAP Client' });
    });

    it('takes the tenant from identity-provisioner and never from the request body', async () => {
      mockIdentityProvisioner(lambdaMock, { resolveTenant: { tenantId: 'the-real-tenant' } });

      await registration.register(
        requestEvent({
          redirect_uris: [LOOPBACK_REDIRECT_URI],
          tenantId: 'attacker-tenant',
          tenant_id: 'attacker-tenant',
          user_id: 'attacker-user',
          sub: 'attacker-sub',
        }),
      );

      const requests = sentRequests(lambdaMock);
      expect(requests[0]).toEqual({ kind: 'RESOLVE_TENANT' });
      expect(requests[1]).toMatchObject({ kind: 'DCR_CHECK', tenantId: 'the-real-tenant' });
      expect(requests[2]).toMatchObject({ kind: 'DCR_PERSIST', tenantId: 'the-real-tenant' });
    });
  });

  describe('a duplicate or over-cap request', () => {
    it('answers 201 with the existing client and its scope for a duplicate, without calling Cognito', async () => {
      mockIdentityProvisioner(lambdaMock, { dcrCheck: { status: 'dedup_hit', clientId: 'existing-client', scope: 'openid email' } });

      const answer = await registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI] }));

      expect(answer.statusCode).toBe(201);
      expect(bodyOf(answer)).toMatchObject({ client_id: 'existing-client', scope: 'openid email' });
      expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(0);
      expect(cognitoMock.commandCalls(DeleteUserPoolClientCommand)).toHaveLength(0);
    });

    it('answers a duplicate that carries no scope with the default scope', async () => {
      mockIdentityProvisioner(lambdaMock, { dcrCheck: { status: 'dedup_hit', clientId: 'existing-client' } });

      const answer = await registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI] }));

      expect(bodyOf(answer)).toMatchObject({ client_id: 'existing-client', scope: 'openid email profile offline_access' });
    });

    it('answers 429 invalid_client_metadata when the tenant is over its cap, without calling Cognito', async () => {
      mockIdentityProvisioner(lambdaMock, { dcrCheck: { status: 'cap_exceeded' } });

      const answer = await registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI] }));

      expect(answer.statusCode).toBe(429);
      expect(bodyOf(answer)).toMatchObject({ error: 'invalid_client_metadata' });
      expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(0);
      expect(warnLog).toHaveBeenCalledWith('jmap_oauth_dcr_rejected', { reason: 'cap_exceeded', tenantId: 'tenant-1' });
    });
  });

  describe('a request that is rejected before it reaches identity-provisioner', () => {
    beforeEach(() => {
      mockIdentityProvisioner(lambdaMock, {});
    });

    it('answers 400 invalid_redirect_uri for a redirect URI whose host is not a loopback host', async () => {
      const answer = await registration.register(requestEvent({ redirect_uris: ['http://127.0.0.1@attacker.com/'] }));

      expect(answer.statusCode).toBe(400);
      expect(bodyOf(answer)).toMatchObject({ error: 'invalid_redirect_uri' });
      expect(warnLog).toHaveBeenCalledWith('jmap_oauth_dcr_rejected', { reason: 'invalid_redirect_uri' });
      expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
      expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(0);
    });

    it('answers 400 invalid_client_metadata, naming the field, for a body without redirect_uris', async () => {
      const answer = await registration.register(requestEvent({ client_name: 'No redirects here' }));

      expect(answer.statusCode).toBe(400);
      expect(bodyOf(answer)).toMatchObject({ error: 'invalid_client_metadata', error_description: expect.stringContaining('redirect_uris') });
      expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
    });

    it('answers 400 invalid_client_metadata for a body that is not JSON', async () => {
      const answer = await registration.register(rawRequestEvent('{not json'));

      expect(answer.statusCode).toBe(400);
      expect(bodyOf(answer)).toEqual({ error: 'invalid_client_metadata', error_description: 'Request body is not valid JSON' });
      expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
    });

    it('answers 400 invalid_client_metadata for a request without a body', async () => {
      const answer = await registration.register(rawRequestEvent(undefined));

      expect(answer.statusCode).toBe(400);
      expect(bodyOf(answer)).toMatchObject({ error: 'invalid_client_metadata', error_description: expect.stringContaining('redirect_uris') });
      expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
    });
  });

  describe('a client that Cognito will not create', () => {
    // RFC 7591 §3.2.2: a registration error is HTTP 400. Cognito rejecting a submitted value is a fault in the request.
    it('answers 400 invalid_client_metadata when Cognito rejects a value with InvalidParameterException', async () => {
      mockIdentityProvisioner(lambdaMock, {});
      cognitoMock.on(CreateUserPoolClientCommand).rejects(Object.assign(new Error('AllowedOAuthScopes are required'), { name: 'InvalidParameterException' }));

      const answer = await registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI] }));

      expect(answer.statusCode).toBe(400);
      expect(bodyOf(answer)).toMatchObject({ error: 'invalid_client_metadata' });
      expect(errorLog).toHaveBeenCalledWith(
        'jmap_oauth_dcr_cognito_create_failed',
        expect.objectContaining({ requestedScope: undefined, cognitoScopes: ['openid', 'email', 'profile'] }),
      );
    });

    // A service failure is ours: reporting it as invalid_client_metadata would tell a correct client to change a correct request.
    it('answers 500 server_error when Cognito fails for any other reason', async () => {
      mockIdentityProvisioner(lambdaMock, {});
      cognitoMock.on(CreateUserPoolClientCommand).rejects(Object.assign(new Error('rate exceeded'), { name: 'TooManyRequestsException' }));

      const answer = await registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI] }));

      expect(answer.statusCode).toBe(500);
      expect(bodyOf(answer)).toMatchObject({ error: 'server_error' });
      expect(sentRequests(lambdaMock).map((request) => request.kind)).toEqual(['RESOLVE_TENANT', 'DCR_CHECK']);
    });
  });

  describe('a client that cannot be recorded', () => {
    it('deletes the client and answers 500 server_error when recording it fails', async () => {
      mockIdentityProvisioner(lambdaMock, { dcrPersist: new Error('network blip') });

      const answer = await registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI] }));

      expect(answer.statusCode).toBe(500);
      expect(bodyOf(answer)).toMatchObject({ error: 'server_error' });
      expect(cognitoMock.commandCalls(DeleteUserPoolClientCommand)).toHaveLength(1);
      expect(cognitoMock.commandCalls(DeleteUserPoolClientCommand)[0].args[0].input).toEqual({ UserPoolId: 'pool-1', ClientId: 'new-client-id' });
      expect(sentRequests(lambdaMock)).toHaveLength(3);
    });

    it('deletes the client and answers 409 invalid_client_metadata when another registration won the race', async () => {
      mockIdentityProvisioner(lambdaMock, { dcrPersist: { status: 'conflict' } });

      const answer = await registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI] }));

      expect(answer.statusCode).toBe(409);
      expect(bodyOf(answer)).toMatchObject({ error: 'invalid_client_metadata' });
      expect(cognitoMock.commandCalls(DeleteUserPoolClientCommand)).toHaveLength(1);
      expect(sentRequests(lambdaMock)).toHaveLength(3);
    });

    it('logs a client it cannot delete and still answers the rejection', async () => {
      mockIdentityProvisioner(lambdaMock, { dcrPersist: { status: 'conflict' } });
      cognitoMock.on(DeleteUserPoolClientCommand).rejects(new Error('denied'));

      const answer = await registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI] }));

      expect(answer.statusCode).toBe(409);
      expect(errorLog).toHaveBeenCalledWith('jmap_oauth_dcr_rollback_failed', { tenantId: 'tenant-1', clientId: 'new-client-id', error: 'Error: denied' });
    });
  });

  it('lets a failure of identity-provisioner reach its caller', async () => {
    mockIdentityProvisioner(lambdaMock, { resolveTenant: new Error('invoke failed') });

    await expect(registration.register(requestEvent({ redirect_uris: [LOOPBACK_REDIRECT_URI] }))).rejects.toThrow('invoke failed');
  });
});
