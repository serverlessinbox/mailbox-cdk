import {
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  DeleteUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';

import { toClientId, type ClientId, type UserPoolId } from '../shared/cognito-identifiers';
import type { RedirectUri, Scope }                    from '../shared/identity-identifiers';

/**
 * The Cognito calls of Dynamic Client Registration. They live in this Lambda and not in `identity-provisioner`,
 * which stays provider-agnostic.
 *
 * `offline_access` is never among the scopes passed in: Cognito issues refresh tokens for `authorization_code`
 * through `ExplicitAuthFlows`, and `offline_access` is not a Cognito OAuth scope.
 */
export class CognitoUserPoolClientManager {
  constructor(private readonly cognito: CognitoIdentityProviderClient) {}

  /** Creates a public (no secret) client for the authorization code flow, and returns its id. */
  public async createClient(userPoolId: UserPoolId, clientName: string, redirectUris: RedirectUri[], scopes: Scope[]): Promise<ClientId> {
    const result = await this.cognito.send(
      new CreateUserPoolClientCommand({
        UserPoolId:                      userPoolId,
        ClientName:                      clientName,
        GenerateSecret:                  false,
        AllowedOAuthFlows:               ['code'],
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthScopes:              scopes,
        CallbackURLs:                    redirectUris,
        SupportedIdentityProviders:      ['COGNITO'],
        ExplicitAuthFlows:               ['ALLOW_REFRESH_TOKEN_AUTH'],
      }),
    );

    const clientId = result.UserPoolClient?.ClientId;
    if (!clientId) {
      throw new Error('CreateUserPoolClient did not return a ClientId');
    }

    return toClientId(clientId);
  }

  public async deleteClient(userPoolId: UserPoolId, clientId: ClientId): Promise<void> {
    await this.cognito.send(new DeleteUserPoolClientCommand({ UserPoolId: userPoolId, ClientId: clientId }));
  }
}
