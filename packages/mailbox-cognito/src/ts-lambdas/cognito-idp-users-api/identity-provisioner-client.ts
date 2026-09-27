import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import * as t from 'typanion';

/**
 * Thin, typed wrapper over `identity-provisioner`'s `PROVISION_USER` invoke contract
 * (`modules/lambdas/identity-provisioner/internal/request.go`). The response crosses a Lambda
 * invoke boundary and is untrusted external data — validated with typanion before use, never a
 * hand-rolled guard.
 */

const isProvisionUserResponse = t.isObject({
  principalId: t.isString(),
  primaryAccountId: t.isString(),
  isNewUser: t.isBoolean(),
});
export type ProvisionUserResponse = t.InferType<typeof isProvisionUserResponse>;

export interface ProvisionUserParams {
  /** Tenant ID from the authorizer context. Absent, never defaulted, when the authorizer did not
   *  supply one. */
  readonly tenantId?: string;
  /** Cognito's immutable `sub` — never the username (a username can be deleted and recreated
   *  under a new `sub`). */
  readonly subject: string;
  readonly username: string;
  readonly email?: string;
  readonly groups: string[];
  readonly isAdmin: boolean;
}

export class IdentityProvisionerClient {
  constructor(
    private readonly functionName: string,
    private readonly lambda: LambdaClient,
  ) {}

  async provisionUser(params: ProvisionUserParams): Promise<ProvisionUserResponse> {
    const payload = {
      kind: 'PROVISION_USER',
      tenantId: params.tenantId,
      provider: 'cognito',
      subject: params.subject,
      username: params.username,
      email: params.email,
      groups: params.groups,
      isAdmin: params.isAdmin,
    };

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
    if (!isProvisionUserResponse(raw, { errors })) {
      throw new Error(`identity-provisioner returned an unexpected shape: ${errors.join('; ')}`);
    }

    return raw;
  }
}
