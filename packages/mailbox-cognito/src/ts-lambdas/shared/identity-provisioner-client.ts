import { InvokeCommand, type InvokeCommandOutput, type LambdaClient } from '@aws-sdk/client-lambda';
import type { FunctionName } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import {
  isDcrCheckResponse,
  isDcrPersistResponse,
  isProvisionUserResponse,
  isResolveTenantResponse,
  type DcrCheckParams,
  type DcrCheckResponse,
  type DcrPersistParams,
  type DcrPersistResponse,
  type IdentityProvisionerRequest,
  type ProvisionUserParams,
  type ProvisionUserResponse,
  type ResolveTenantResponse,
} from './identity-provisioner-contract';

type ResponseValidator<Response> = (value: unknown, state?: { errors?: string[] }) => value is Response;

/**
 * Typed client of the `identity-provisioner` Lambda's invoke contract. Every response is untrusted external
 * data and is validated against its schema before it is returned. It makes no Cognito calls: the Lambda it
 * invokes stays provider-agnostic.
 */
export class IdentityProvisionerClient {
  constructor(
    private readonly functionName: FunctionName,
    private readonly lambda: LambdaClient,
  ) {}

  public async resolveTenant(): Promise<ResolveTenantResponse> {
    return this.invoke({ kind: 'RESOLVE_TENANT' }, isResolveTenantResponse);
  }

  public async dcrCheck(params: DcrCheckParams): Promise<DcrCheckResponse> {
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

  public async dcrPersist(params: DcrPersistParams): Promise<DcrPersistResponse> {
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

  public async provisionUser(params: ProvisionUserParams): Promise<ProvisionUserResponse> {
    return this.invoke(
      {
        kind: 'PROVISION_USER',
        tenantId: params.tenantId,
        provider: 'cognito',
        subject: params.subject,
        username: params.username,
        email: params.email,
        groups: params.groups,
        isAdmin: params.isAdmin,
      },
      isProvisionUserResponse,
    );
  }

  private async invoke<Response>(request: IdentityProvisionerRequest, isExpectedShape: ResponseValidator<Response>): Promise<Response> {
    const result = await this.lambda.send(
      new InvokeCommand({
        FunctionName: this.functionName,
        Payload: Buffer.from(JSON.stringify(request)),
      }),
    );

    this.assertNoFunctionError(result);
    const response = this.decodePayload(result);

    return this.validate(response, isExpectedShape);
  }

  private assertNoFunctionError(result: InvokeCommandOutput): void {
    if (result.FunctionError) {
      throw new Error(`identity-provisioner invoke failed: ${result.FunctionError}`);
    }
  }

  private decodePayload(result: InvokeCommandOutput): unknown {
    return result.Payload ? JSON.parse(Buffer.from(result.Payload).toString('utf-8')) : undefined;
  }

  private validate<Response>(response: unknown, isExpectedShape: ResponseValidator<Response>): Response {
    const errors: string[] = [];
    if (!isExpectedShape(response, { errors })) {
      throw new Error(`identity-provisioner returned an unexpected shape: ${errors.join('; ')}`);
    }
    return response;
  }
}
