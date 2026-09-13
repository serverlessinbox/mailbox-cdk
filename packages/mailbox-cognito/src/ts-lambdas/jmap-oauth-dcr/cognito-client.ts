import {
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  DeleteUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';

/**
 * Cognito SDK calls for Dynamic Client Registration. Kept entirely in this TS Lambda — never in
 * `identity-provisioner`, which must stay provider-agnostic (binding decision #1).
 *
 * `offline_access` is never passed in `scopes`: it is excluded from the Cognito-bound scope list
 * before this is called (the plan's response-shaping rule) — Cognito refresh-token issuance for
 * `authorization_code` is controlled by `ExplicitAuthFlows`, not by an `AllowedOAuthScopes` entry,
 * and `offline_access` is not itself a valid Cognito OAuth scope value.
 */

export interface CreatedUserPoolClient {
  readonly clientId: string;
}

export class CognitoUserPoolClientManager {
  constructor(private readonly cognito: CognitoIdentityProviderClient) {}

  async createClient(userPoolId: string, clientName: string, redirectUris: string[], scopes: string[]): Promise<CreatedUserPoolClient> {
    const result = await this.cognito.send(
      new CreateUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientName: clientName,
        GenerateSecret: false,
        AllowedOAuthFlows: ['code'],
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthScopes: scopes,
        CallbackURLs: redirectUris,
        SupportedIdentityProviders: ['COGNITO'],
        ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH'],
      }),
    );

    const clientId = result.UserPoolClient?.ClientId;
    if (!clientId) {
      throw new Error('CreateUserPoolClient did not return a ClientId');
    }

    return { clientId };
  }

  async deleteClient(userPoolId: string, clientId: string): Promise<void> {
    await this.cognito.send(new DeleteUserPoolClientCommand({ UserPoolId: userPoolId, ClientId: clientId }));
  }
}
