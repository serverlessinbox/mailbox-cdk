import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import * as t from 'typanion';

/**
 * Thin, typed wrapper over `identity-provisioner`'s `Kind`-discriminated invoke contract
 * (`modules/lambdas/identity-provisioner/main.go`). Every response is untrusted external data
 * (crosses a Lambda invoke boundary) and is validated with typanion before use — never a hand
 * -rolled guard, never an `as` cast past the JSON.parse boundary.
 *
 * Cognito SDK calls never happen here — this client only ever exchanges JSON envelopes with a
 * Lambda that must stay provider-agnostic (binding decision #1).
 */

const isResolveTenantResponse = t.isObject({ tenantId: t.isString() });
export type ResolveTenantResponse = t.InferType<typeof isResolveTenantResponse>;

const isDcrCheckResponse = t.isObject({
  status: t.isEnum(['proceed', 'dedup_hit', 'cap_exceeded'] as const),
  clientId: t.isOptional(t.isString()),
  scope: t.isOptional(t.isString()),
});
export type DcrCheckResponse = t.InferType<typeof isDcrCheckResponse>;

const isDcrPersistResponse = t.isObject({
  status: t.isEnum(['success', 'conflict'] as const),
});
export type DcrPersistResponse = t.InferType<typeof isDcrPersistResponse>;

export interface DcrCheckParams {
  readonly tenantId: string;
  readonly redirectUris: string[];
  readonly clientName: string;
}

export interface DcrPersistParams {
  readonly tenantId: string;
  readonly clientId: string;
  readonly redirectUris: string[];
  readonly clientName: string;
  readonly scope: string;
}

export class IdentityProvisionerClient {
  constructor(
    private readonly functionName: string,
    private readonly lambda: LambdaClient = new LambdaClient({}),
  ) {}

  /**
   * Resolves the tenant for this request. Never derives a tenant from the request body
   * (binding decision #11) — the caller passes nothing identity-shaped in.
   */
  async resolveTenant(): Promise<ResolveTenantResponse> {
    return this.invoke({ kind: 'RESOLVE_TENANT' }, isResolveTenantResponse);
  }

  async dcrCheck(params: DcrCheckParams): Promise<DcrCheckResponse> {
    return this.invoke(
      {
        kind: 'DCR_CHECK',
        tenantId: params.tenantId,
        redirectUris: params.redirectUris,
        clientName: params.clientName,
      },
      isDcrCheckResponse,
    );
  }

  async dcrPersist(params: DcrPersistParams): Promise<DcrPersistResponse> {
    return this.invoke(
      {
        kind: 'DCR_PERSIST',
        tenantId: params.tenantId,
        clientId: params.clientId,
        redirectUris: params.redirectUris,
        clientName: params.clientName,
        scope: params.scope,
      },
      isDcrPersistResponse,
    );
  }

  private async invoke<T>(
    payload: unknown,
    isExpectedShape: (v: unknown, opts?: { errors?: string[] }) => v is T,
  ): Promise<T> {
    const result = await this.lambda.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
    );

    if (result.FunctionError) {
      throw new Error(`identity-provisioner invoke failed: ${result.FunctionError}`);
    }

    const raw: unknown = result.Payload ? JSON.parse(Buffer.from(result.Payload).toString('utf-8')) : undefined;

    const errors: string[] = [];
    if (!isExpectedShape(raw, { errors })) {
      throw new Error(`identity-provisioner returned an unexpected shape: ${errors.join('; ')}`);
    }

    return raw;
  }
}
