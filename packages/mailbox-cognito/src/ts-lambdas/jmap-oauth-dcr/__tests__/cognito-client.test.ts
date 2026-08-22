/// <reference types="jest" />

import {
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  DeleteUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';

import { CognitoUserPoolClientManager } from '../cognito-client';

describe('CognitoUserPoolClientManager', () => {
  const cognitoMock = mockClient(CognitoIdentityProviderClient);

  beforeEach(() => {
    cognitoMock.reset();
  });

  it('createClient forces a public (no-secret) client with the given pool, name, redirect URIs and scopes', async () => {
    cognitoMock.on(CreateUserPoolClientCommand).resolves({ UserPoolClient: { ClientId: 'abc123' } });

    const manager = new CognitoUserPoolClientManager(cognitoMock as unknown as CognitoIdentityProviderClient);
    const result = await manager.createClient('pool-1', 'My App', ['http://127.0.0.1/cb'], ['openid', 'email']);

    expect(result).toEqual({ clientId: 'abc123' });
    const call = cognitoMock.commandCalls(CreateUserPoolClientCommand)[0];
    expect(call.args[0].input).toMatchObject({
      UserPoolId: 'pool-1',
      ClientName: 'My App',
      GenerateSecret: false,
      CallbackURLs: ['http://127.0.0.1/cb'],
      AllowedOAuthScopes: ['openid', 'email'],
    });
  });

  it('throws if Cognito does not return a ClientId', async () => {
    cognitoMock.on(CreateUserPoolClientCommand).resolves({ UserPoolClient: {} });

    const manager = new CognitoUserPoolClientManager(cognitoMock as unknown as CognitoIdentityProviderClient);
    await expect(manager.createClient('pool-1', 'My App', ['http://127.0.0.1/cb'], ['openid'])).rejects.toThrow(
      /did not return a ClientId/,
    );
  });

  it('deleteClient issues DeleteUserPoolClient for the given pool and client', async () => {
    cognitoMock.on(DeleteUserPoolClientCommand).resolves({});

    const manager = new CognitoUserPoolClientManager(cognitoMock as unknown as CognitoIdentityProviderClient);
    await manager.deleteClient('pool-1', 'abc123');

    const call = cognitoMock.commandCalls(DeleteUserPoolClientCommand)[0];
    expect(call.args[0].input).toMatchObject({ UserPoolId: 'pool-1', ClientId: 'abc123' });
  });
});
