/// <reference types="jest" />

/**
 * Pins the client that is created in the user pool for a dynamic registration: public (no secret), for the
 * authorization code flow, in the given pool with the given redirect URIs and scopes. Cognito rejects an OAuth
 * client with no allowed flows or scopes, and a client with a secret would not be a public one.
 */

import {
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  DeleteUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient }                   from 'aws-sdk-client-mock';

import { toClientId, toUserPoolId }     from '../../shared/cognito-identifiers';
import { toRedirectUri, toScope }       from '../../shared/identity-identifiers';
import { CognitoUserPoolClientManager } from '../cognito-client';

const USER_POOL_ID = toUserPoolId('pool-1');

describe('CognitoUserPoolClientManager', () => {
  const cognitoMock = mockClient(CognitoIdentityProviderClient);
  const manager     = new CognitoUserPoolClientManager(new CognitoIdentityProviderClient({}));

  beforeEach(() => {
    cognitoMock.reset();
  });

  it('createClient creates a public client for the authorization code flow and returns its id', async () => {
    cognitoMock.on(CreateUserPoolClientCommand).resolves({ UserPoolClient: { ClientId: 'abc123' } });

    const clientId = await manager.createClient(USER_POOL_ID, 'My App', [toRedirectUri('http://127.0.0.1/cb')], [toScope('openid'), toScope('email')]);

    expect(clientId).toBe('abc123');
    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)[0].args[0].input).toEqual({
      UserPoolId: 'pool-1',
      ClientName: 'My App',
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: ['openid', 'email'],
      CallbackURLs: ['http://127.0.0.1/cb'],
      SupportedIdentityProviders: ['COGNITO'],
      ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH'],
    });
  });

  it('createClient throws when Cognito does not return a ClientId', async () => {
    cognitoMock.on(CreateUserPoolClientCommand).resolves({ UserPoolClient: {} });

    await expect(manager.createClient(USER_POOL_ID, 'My App', [toRedirectUri('http://127.0.0.1/cb')], [toScope('openid')])).rejects.toThrow(
      /did not return a ClientId/,
    );
  });

  it('deleteClient deletes the client from the pool', async () => {
    cognitoMock.on(DeleteUserPoolClientCommand).resolves({});

    await manager.deleteClient(USER_POOL_ID, toClientId('abc123'));

    expect(cognitoMock.commandCalls(DeleteUserPoolClientCommand)[0].args[0].input).toEqual({ UserPoolId: 'pool-1', ClientId: 'abc123' });
  });
});
