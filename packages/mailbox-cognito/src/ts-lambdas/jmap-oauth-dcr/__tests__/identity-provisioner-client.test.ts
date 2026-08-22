/// <reference types="jest" />

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';

import { IdentityProvisionerClient } from '../identity-provisioner-client';

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

  beforeEach(() => {
    lambdaMock.reset();
  });

  it('resolveTenant sends kind=RESOLVE_TENANT and parses { tenantId }', async () => {
    lambdaMock.on(InvokeCommand).resolves({ Payload: payloadOf({ tenantId: 'tenant-1' }) });

    const client = new IdentityProvisionerClient('fn-name', lambdaMock as unknown as LambdaClient);
    const result = await client.resolveTenant();

    expect(result).toEqual({ tenantId: 'tenant-1' });
    const call = lambdaMock.commandCalls(InvokeCommand)[0];
    expect(call.args[0].input.FunctionName).toBe('fn-name');
    expect(JSON.parse(Buffer.from(call.args[0].input.Payload as Uint8Array).toString('utf-8'))).toEqual({
      kind: 'RESOLVE_TENANT',
    });
  });

  it('dcrCheck sends the exact DCR_CHECK envelope and parses the response', async () => {
    lambdaMock.on(InvokeCommand).resolves({ Payload: payloadOf({ status: 'proceed' }) });

    const client = new IdentityProvisionerClient('fn-name', lambdaMock as unknown as LambdaClient);
    const result = await client.dcrCheck({ tenantId: 't1', redirectUris: ['http://127.0.0.1/cb'], clientName: 'My App' });

    expect(result).toEqual({ status: 'proceed' });
    const call = lambdaMock.commandCalls(InvokeCommand)[0];
    expect(JSON.parse(Buffer.from(call.args[0].input.Payload as Uint8Array).toString('utf-8'))).toEqual({
      kind: 'DCR_CHECK',
      tenantId: 't1',
      redirectUris: ['http://127.0.0.1/cb'],
      clientName: 'My App',
    });
  });

  it('dcrPersist sends the exact DCR_PERSIST envelope and parses the response', async () => {
    lambdaMock.on(InvokeCommand).resolves({ Payload: payloadOf({ status: 'success' }) });

    const client = new IdentityProvisionerClient('fn-name', lambdaMock as unknown as LambdaClient);
    const result = await client.dcrPersist({
      tenantId: 't1',
      clientId: 'client-1',
      redirectUris: ['http://127.0.0.1/cb'],
      clientName: 'My App',
      scope: 'openid email',
    });

    expect(result).toEqual({ status: 'success' });
    const call = lambdaMock.commandCalls(InvokeCommand)[0];
    expect(JSON.parse(Buffer.from(call.args[0].input.Payload as Uint8Array).toString('utf-8'))).toEqual({
      kind: 'DCR_PERSIST',
      tenantId: 't1',
      clientId: 'client-1',
      redirectUris: ['http://127.0.0.1/cb'],
      clientName: 'My App',
      scope: 'openid email',
    });
  });

  it('throws when the Lambda invoke reports a FunctionError', async () => {
    lambdaMock.on(InvokeCommand).resolves({ FunctionError: 'Unhandled', Payload: payloadOf({}) });

    const client = new IdentityProvisionerClient('fn-name', lambdaMock as unknown as LambdaClient);
    await expect(client.resolveTenant()).rejects.toThrow(/identity-provisioner invoke failed/);
  });

  it('throws when the response payload does not match the expected shape', async () => {
    lambdaMock.on(InvokeCommand).resolves({ Payload: payloadOf({ unexpected: true }) });

    const client = new IdentityProvisionerClient('fn-name', lambdaMock as unknown as LambdaClient);
    await expect(client.resolveTenant()).rejects.toThrow(/unexpected shape/);
  });
});
