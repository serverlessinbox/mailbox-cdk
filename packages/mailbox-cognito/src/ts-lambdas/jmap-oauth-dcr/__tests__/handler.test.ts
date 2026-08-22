/// <reference types="jest" />

import './set-test-env';

import {
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  DeleteUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';

import { handler } from '../handler';

/** See `identity-provisioner-client.test.ts` for why this shape (not a plain `Uint8Array`). */
function encode(value: unknown): Uint8Array & { transformToString(encoding?: string): string } {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Object.assign(bytes, {
    transformToString: (): string => new TextDecoder().decode(bytes),
  });
}

function requestEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /oauth/register',
    rawPath: '/oauth/register',
    rawQueryString: '',
    headers: {},
    requestContext: {} as APIGatewayProxyEventV2['requestContext'],
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

/** `APIGatewayProxyResultV2` allows a bare-string shorthand; this handler never returns that. */
function asObjectResult(result: Awaited<ReturnType<typeof handler>>): { statusCode: number; body: string } {
  if (typeof result === 'string') {
    throw new Error('expected an object result, got a bare string');
  }
  return result as { statusCode: number; body: string };
}

/**
 * Wires the Lambda mock so `RESOLVE_TENANT`/`DCR_CHECK`/`DCR_PERSIST` each get their own
 * configurable response, keyed on the invoke payload's `kind` — mirrors how
 * `identity-provisioner`'s real `Kind` envelope dispatches.
 */
function mockIdentityProvisioner(
  lambdaMock: ReturnType<typeof mockClient>,
  responses: {
    resolveTenant?: unknown;
    dcrCheck?: unknown;
    dcrPersist?: unknown;
  },
): void {
  lambdaMock.on(InvokeCommand).callsFake((input: { Payload: Uint8Array }) => {
    const payload = JSON.parse(Buffer.from(input.Payload).toString('utf-8'));
    switch (payload.kind) {
      case 'RESOLVE_TENANT':
        return { Payload: encode(responses.resolveTenant ?? { tenantId: 'tenant-1' }) };
      case 'DCR_CHECK':
        return { Payload: encode(responses.dcrCheck ?? { status: 'proceed' }) };
      case 'DCR_PERSIST':
        return { Payload: encode(responses.dcrPersist ?? { status: 'success' }) };
      default:
        throw new Error(`unexpected kind: ${payload.kind}`);
    }
  });
}

describe('jmap-oauth-dcr handler', () => {
  const lambdaMock = mockClient(LambdaClient);
  const cognitoMock = mockClient(CognitoIdentityProviderClient);

  beforeEach(() => {
    lambdaMock.reset();
    cognitoMock.reset();
    cognitoMock.on(CreateUserPoolClientCommand).resolves({ UserPoolClient: { ClientId: 'new-client-id' } });
    cognitoMock.on(DeleteUserPoolClientCommand).resolves({});
  });

  it('proceed path: registers a new Cognito client and returns an RFC 7591 §3.2.1 shaped response', async () => {
    mockIdentityProvisioner(lambdaMock, {});

    const result = asObjectResult(await handler(requestEvent({ redirect_uris: ['http://127.0.0.1:4321/cb'], client_name: 'My App' })));

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body).toMatchObject({
      client_id: 'new-client-id',
      redirect_uris: ['http://127.0.0.1:4321/cb'],
      token_endpoint_auth_method: 'none',
      client_name: 'My App',
    });
    expect(typeof body.client_id_issued_at).toBe('number');
    expect(typeof body.scope).toBe('string');

    // Cognito was invoked exactly once, with the client forced to public/no-secret.
    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(1);
    const createInput = cognitoMock.commandCalls(CreateUserPoolClientCommand)[0].args[0].input;
    expect(createInput.GenerateSecret).toBe(false);
  });

  it('offline_access is excluded from the Cognito-bound scope but scope is still present in the response', async () => {
    mockIdentityProvisioner(lambdaMock, {});

    await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'], scope: 'openid offline_access' }));

    const createInput = cognitoMock.commandCalls(CreateUserPoolClientCommand)[0].args[0].input;
    expect(createInput.AllowedOAuthScopes).toEqual(['openid']);
  });

  it('defaults client_name when absent', async () => {
    mockIdentityProvisioner(lambdaMock, {});

    const result = asObjectResult(await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'] })));

    const body = JSON.parse(result.body as string);
    expect(body.client_name).toBe('Unnamed JMAP Client');
  });

  it('defaults client_name when present but empty', async () => {
    mockIdentityProvisioner(lambdaMock, {});

    const result = asObjectResult(await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'], client_name: '   ' })));

    const body = JSON.parse(result.body as string);
    expect(body.client_name).toBe('Unnamed JMAP Client');
  });

  it('dedup_hit: returns the existing client_id/scope and makes zero Cognito calls', async () => {
    mockIdentityProvisioner(lambdaMock, { dcrCheck: { status: 'dedup_hit', clientId: 'existing-client', scope: 'openid email' } });

    const result = asObjectResult(await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'] })));

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body as string);
    expect(body.client_id).toBe('existing-client');
    expect(body.scope).toBe('openid email');

    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(0);
    expect(cognitoMock.commandCalls(DeleteUserPoolClientCommand)).toHaveLength(0);
  });

  it('cap_exceeded: returns HTTP 429 invalid_client_metadata and makes zero Cognito calls', async () => {
    mockIdentityProvisioner(lambdaMock, { dcrCheck: { status: 'cap_exceeded' } });

    const result = asObjectResult(await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'] })));

    expect(result.statusCode).toBe(429);
    expect(JSON.parse(result.body as string)).toMatchObject({ error: 'invalid_client_metadata' });
    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(0);
  });

  it('rejects a hostile redirect_uri before any invoke or AWS call', async () => {
    const result = asObjectResult(await handler(requestEvent({ redirect_uris: ['http://127.0.0.1@attacker.com/'] })));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string)).toMatchObject({ error: 'invalid_redirect_uri' });
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(0);
  });

  it('rejects a malformed body (missing redirect_uris) before any invoke or AWS call', async () => {
    const result = asObjectResult(await handler(requestEvent({ client_name: 'No redirects here' })));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string)).toMatchObject({ error: 'invalid_client_metadata' });
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('DCR_PERSIST failure (throw): rolls back the Cognito client and issues no cap-decrement call', async () => {
    lambdaMock.on(InvokeCommand).callsFake((input: { Payload: Uint8Array }) => {
      const payload = JSON.parse(Buffer.from(input.Payload).toString('utf-8'));
      if (payload.kind === 'RESOLVE_TENANT') return { Payload: encode({ tenantId: 'tenant-1' }) };
      if (payload.kind === 'DCR_CHECK') return { Payload: encode({ status: 'proceed' }) };
      if (payload.kind === 'DCR_PERSIST') throw new Error('network blip');
      throw new Error(`unexpected kind: ${payload.kind}`);
    });

    const result = asObjectResult(await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'] })));

    expect(result.statusCode).toBe(500);
    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(1);
    expect(cognitoMock.commandCalls(DeleteUserPoolClientCommand)).toHaveLength(1);
    expect(cognitoMock.commandCalls(DeleteUserPoolClientCommand)[0].args[0].input).toMatchObject({
      UserPoolId: 'pool-1',
      ClientId: 'new-client-id',
    });

    // Exactly 3 identity-provisioner invokes total (RESOLVE_TENANT, DCR_CHECK, DCR_PERSIST) —
    // no fourth call of any kind, i.e. no decrement request exists to make (decision #5: the
    // cap counter is never decremented — there is no RPC for it at all).
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(3);
  });

  it('DCR_PERSIST conflict status: rolls back the Cognito client and returns HTTP 409', async () => {
    mockIdentityProvisioner(lambdaMock, { dcrPersist: { status: 'conflict' } });

    const result = asObjectResult(await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'] })));

    expect(result.statusCode).toBe(409);
    expect(cognitoMock.commandCalls(DeleteUserPoolClientCommand)).toHaveLength(1);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(3);
  });

  it('never lets a body field that looks like a tenant/user identity influence the resolved tenantId', async () => {
    mockIdentityProvisioner(lambdaMock, { resolveTenant: { tenantId: 'the-real-tenant' } });

    await handler(
      requestEvent({
        redirect_uris: ['http://127.0.0.1/cb'],
        // Attacker-controlled, unauthenticated body claiming a different tenant/user.
        tenantId: 'attacker-tenant',
        tenant_id: 'attacker-tenant',
        user_id: 'attacker-user',
        sub: 'attacker-sub',
      }),
    );

    const calls = lambdaMock.commandCalls(InvokeCommand);
    const payloads = calls.map((c) => JSON.parse(Buffer.from(c.args[0].input.Payload as Uint8Array).toString('utf-8')));

    const dcrCheckPayload = payloads.find((p) => p.kind === 'DCR_CHECK');
    const dcrPersistPayload = payloads.find((p) => p.kind === 'DCR_PERSIST');
    expect(dcrCheckPayload.tenantId).toBe('the-real-tenant');
    expect(dcrPersistPayload.tenantId).toBe('the-real-tenant');

    // The RESOLVE_TENANT request itself carries nothing from the body.
    const resolveTenantPayload = payloads.find((p) => p.kind === 'RESOLVE_TENANT');
    expect(resolveTenantPayload).toEqual({ kind: 'RESOLVE_TENANT' });
  });
});
