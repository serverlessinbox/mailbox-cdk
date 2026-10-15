/// <reference types="jest" />

/**
 * Pins the envelope the client sends for each kind of request and the validation of every response. The
 * `identity-provisioner` Lambda dispatches on `kind` and reads the fields by name, so a changed key or kind is
 * answered with an error or, worse, acted on as another request; a response that is not checked would hand
 * its caller a value of the wrong shape.
 */

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';

import { toFunctionName, toTenantId } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { toClientId, toGroupName, toUserSubject, toUsername } from '../cognito-identifiers';
import { toEmailAddress, toRedirectUri } from '../identity-identifiers';
import { IdentityProvisionerClient } from '../identity-provisioner-client';

const TENANT_ID = toTenantId('t1');
const REDIRECT_URIS = [toRedirectUri('http://127.0.0.1/cb')];

/**
 * The real AWS SDK v3 `InvokeCommandOutput.Payload` type is `Uint8ArrayBlobAdapter`
 * (`@smithy/util-stream`) — a `Uint8Array` subclass with an added `transformToString()`.
 * Rather than pull in that transitive package as a direct test dependency, build a minimal
 * value with the same shape — structurally sufficient for both the mock and `IdentityProvisionerClient`'s
 * own `Buffer.from(...)` read of the raw bytes.
 */
function payloadOf(response: unknown): Uint8Array & { transformToString(encoding?: string): string } {
  const bytes = new TextEncoder().encode(JSON.stringify(response));
  return Object.assign(bytes, {
    transformToString: (): string => new TextDecoder().decode(bytes),
  });
}

describe('IdentityProvisionerClient', () => {
  const lambdaMock = mockClient(LambdaClient);
  const client = new IdentityProvisionerClient(toFunctionName('fn-name'), new LambdaClient({}));

  function sentEnvelope(): unknown {
    const input = lambdaMock.commandCalls(InvokeCommand)[0].args[0].input;
    return JSON.parse(Buffer.from(input.Payload as Uint8Array).toString('utf-8'));
  }

  beforeEach(() => {
    lambdaMock.reset();
  });

  it('resolveTenant sends kind=RESOLVE_TENANT to the configured function and parses { tenantId }', async () => {
    lambdaMock.on(InvokeCommand).resolves({ Payload: payloadOf({ tenantId: 'tenant-1' }) });

    const result = await client.resolveTenant();

    expect(result).toEqual({ tenantId: 'tenant-1' });
    expect(lambdaMock.commandCalls(InvokeCommand)[0].args[0].input.FunctionName).toBe('fn-name');
    expect(sentEnvelope()).toEqual({ kind: 'RESOLVE_TENANT' });
  });

  it('dcrCheck sends the exact DCR_CHECK envelope and parses the response', async () => {
    lambdaMock.on(InvokeCommand).resolves({ Payload: payloadOf({ status: 'proceed' }) });

    const result = await client.dcrCheck({ tenantId: TENANT_ID, redirectUris: REDIRECT_URIS, clientName: 'My App' });

    expect(result).toEqual({ status: 'proceed' });
    expect(sentEnvelope()).toEqual({
      kind: 'DCR_CHECK',
      tenantId: 't1',
      redirectUris: ['http://127.0.0.1/cb'],
      clientName: 'My App',
    });
  });

  it('dcrPersist sends the exact DCR_PERSIST envelope and parses the response', async () => {
    lambdaMock.on(InvokeCommand).resolves({ Payload: payloadOf({ status: 'success' }) });

    const result = await client.dcrPersist({
      tenantId: TENANT_ID,
      clientId: toClientId('client-1'),
      redirectUris: REDIRECT_URIS,
      clientName: 'My App',
      scope: 'openid email',
    });

    expect(result).toEqual({ status: 'success' });
    expect(sentEnvelope()).toEqual({
      kind: 'DCR_PERSIST',
      tenantId: 't1',
      clientId: 'client-1',
      redirectUris: ['http://127.0.0.1/cb'],
      clientName: 'My App',
      scope: 'openid email',
    });
  });

  it('provisionUser sends the exact PROVISION_USER envelope for the cognito provider and parses the response', async () => {
    lambdaMock.on(InvokeCommand).resolves({ Payload: payloadOf({ principalId: 'p1', primaryAccountId: 'a1', isNewUser: true }) });

    const result = await client.provisionUser({
      tenantId: TENANT_ID,
      subject: toUserSubject('cognito-sub-abc'),
      username: toUsername('newuser'),
      email: toEmailAddress('newuser@example.com'),
      groups: [toGroupName('user')],
      isAdmin: false,
    });

    expect(result).toEqual({ principalId: 'p1', primaryAccountId: 'a1', isNewUser: true });
    expect(sentEnvelope()).toEqual({
      kind: 'PROVISION_USER',
      tenantId: 't1',
      provider: 'cognito',
      subject: 'cognito-sub-abc',
      username: 'newuser',
      email: 'newuser@example.com',
      groups: ['user'],
      isAdmin: false,
    });
  });

  it('throws when the Lambda invoke reports a FunctionError', async () => {
    lambdaMock.on(InvokeCommand).resolves({ FunctionError: 'Unhandled', Payload: payloadOf({}) });

    await expect(client.resolveTenant()).rejects.toThrow('identity-provisioner invoke failed: Unhandled');
  });

  it('throws when the response payload does not match the expected shape', async () => {
    lambdaMock.on(InvokeCommand).resolves({ Payload: payloadOf({ unexpected: true }) });

    await expect(client.resolveTenant()).rejects.toThrow(/unexpected shape/);
  });

  it('throws when the invoke returns no payload', async () => {
    lambdaMock.on(InvokeCommand).resolves({});

    await expect(client.provisionUser({
      subject: toUserSubject('sub'),
      username: toUsername('u'),
      groups: [],
      isAdmin: false,
    })).rejects.toThrow(/unexpected shape/);
  });
});
