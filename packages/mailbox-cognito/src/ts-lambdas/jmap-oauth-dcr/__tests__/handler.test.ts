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
import { SmokeTestProbe, withSmokeTest, env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from '../config';

import { createHandler } from '../handler';
import { CognitoUserPoolClientManager } from '../cognito-client';
import { IdentityProvisionerClient } from '../identity-provisioner-client';

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

/** Unwrap APIGatewayProxyResultV2 (which allows bare-string shorthand) to object form. */
function asObjectResult(result: unknown): { statusCode: number; body: string } {
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

  let handler: (event: APIGatewayProxyEventV2) => Promise<unknown>;


  beforeEach(() => {
    lambdaMock.reset();
    cognitoMock.reset();
    cognitoMock.on(CreateUserPoolClientCommand).resolves({ UserPoolClient: { ClientId: 'new-client-id' } });
    cognitoMock.on(DeleteUserPoolClientCommand).resolves({});

    // Create handler with mocked clients for this test
    const lambdaClient = new LambdaClient({});
    const cognitoClient = new CognitoIdentityProviderClient({});
    const identityProvisioner = new IdentityProvisionerClient('identity-provisioner-fn', lambdaClient);
    const cognitoManager = new CognitoUserPoolClientManager(cognitoClient);

    handler = createHandler({
      identityProvisioner,
      cognito: cognitoManager,
      userPoolId: 'pool-1',
      serviceName: 'jmap-oauth-dcr',
      logLevel: 'error',
    });
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

  // REGRESSION (live dev, 2026-08-23): a client registered with a scope that reduces to nothing
  // once `offline_access` is stripped. Cognito was then called with `AllowedOAuthScopes: []` and
  // rejected the whole registration:
  //   "InvalidParameterException: AllowedOAuthFlows and AllowedOAuthScopes are required if user
  //    pool client is allowed to use OAuth flows."
  // `AllowedOAuthScopes` must therefore never be empty, whatever the client asked for.
  it.each([
    ['only offline_access', 'offline_access'],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('substitutes the default scope when the request asks for %s', async (_label, scope) => {
    mockIdentityProvisioner(lambdaMock, {});

    const result = asObjectResult(await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'], scope })));

    expect(result.statusCode).toBe(201);
    const createInput = cognitoMock.commandCalls(CreateUserPoolClientCommand)[0].args[0].input;
    expect(createInput.AllowedOAuthScopes).toEqual(['openid', 'email', 'profile']);
    // The response reports what was actually granted, per RFC 7591 §3.2.1.
    expect(JSON.parse(result.body as string).scope).toBe('openid email profile');
  });

  // RFC 7591 §3.2.2: a registration error is an HTTP 400. Cognito rejecting a submitted metadata
  // value is a fault in the request, not in the server, and must not surface as a 500.
  it('maps a Cognito InvalidParameterException to HTTP 400 invalid_client_metadata', async () => {
    mockIdentityProvisioner(lambdaMock, {});
    cognitoMock.on(CreateUserPoolClientCommand).rejects(
      Object.assign(new Error('AllowedOAuthScopes are required'), { name: 'InvalidParameterException' }),
    );

    const result = asObjectResult(await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'] })));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string)).toMatchObject({ error: 'invalid_client_metadata' });
  });

  // A genuine service failure stays a 500 — but must say `server_error`, not blame the client's
  // metadata. Reporting `invalid_client_metadata` here tells a correct client to "fix" a correct
  // request.
  it('maps a Cognito service failure to HTTP 500 server_error', async () => {
    mockIdentityProvisioner(lambdaMock, {});
    cognitoMock.on(CreateUserPoolClientCommand).rejects(
      Object.assign(new Error('rate exceeded'), { name: 'TooManyRequestsException' }),
    );

    const result = asObjectResult(await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'] })));

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body as string)).toMatchObject({ error: 'server_error' });
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

describe('jmap-oauth-dcr handler — smoke test wrapper', () => {
  const lambdaMock = mockClient(LambdaClient);
  const cognitoMock = mockClient(CognitoIdentityProviderClient);

  let handler: (event: APIGatewayProxyEventV2 | SmokeTestProbe) => Promise<unknown>;

  beforeEach(() => {
    lambdaMock.reset();
    cognitoMock.reset();

    // Create handler with mocked clients, wrapped with smoke test
    const lambdaClient = new LambdaClient({});
    const cognitoClient = new CognitoIdentityProviderClient({});
    const identityProvisioner = new IdentityProvisionerClient('identity-provisioner-fn', lambdaClient);
    const cognitoManager = new CognitoUserPoolClientManager(cognitoClient);

    const rawHandler = createHandler({
      identityProvisioner,
      cognito: cognitoManager,
      userPoolId: 'pool-1',
      serviceName: 'jmap-oauth-dcr',
      logLevel: 'error',
    });

    // Wrap with smoke test wrapper and config check
    handler = withSmokeTest(rawHandler, env.check(load));
  });

  it('responds to smoke test probe without invoking the real handler', async () => {
    const probeEvent: SmokeTestProbe = { serverlessInboxSmokeTest: true };
    const result = await handler(probeEvent);

    expect(result).toEqual({ serverlessInboxSmokeTestOk: true });

    // Verify no Lambda invocations (identity-provisioner calls) were made
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);

    // Verify no Cognito operations were invoked
    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(0);
    expect(cognitoMock.commandCalls(DeleteUserPoolClientCommand)).toHaveLength(0);
  });

  it('invalid LOG_LEVEL fails the cold start: importing index throws naming LOG_LEVEL', async () => {
    // index.ts calls env.mustLoad(load) at module scope, which throws at import time
    // if LOG_LEVEL is not one of the valid log levels ('debug', 'info', 'warn', 'error').
    const savedEnv = { ...process.env };

    try {
      jest.isolateModules(() => {
        process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'test-fn';
        process.env.USER_POOL_ID = 'pool-1';
        process.env.LOG_LEVEL = 'verbose'; // Invalid log level

        // Require-based import for ESM/CJS compatibility
        expect(() => {
          require('../index');
        }).toThrow(/LOG_LEVEL/);
      });
    } finally {
      process.env = savedEnv;
    }
  });
});
