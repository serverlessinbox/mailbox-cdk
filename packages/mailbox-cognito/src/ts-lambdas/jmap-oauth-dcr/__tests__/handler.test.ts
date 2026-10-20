/// <reference types="jest" />

/**
 * Pins the wiring of the DCR handler: that a registration runs against the user pool and the identity
 * provisioner function of its configuration, and what an unexpected failure answers. A failure nobody recognised
 * must answer 500 and write the buffered trace that led to it; without the trace, the log of the failing
 * invocation holds no more than the failure itself.
 */

import './set-test-env';

import { CognitoIdentityProviderClient, CreateUserPoolClientCommand } from '@aws-sdk/client-cognito-identity-provider';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import type { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { handler } from '../handler';
import { mockIdentityProvisioner, requestEvent } from './jmap-oauth-dcr-helpers';

type Handler = typeof handler;

/**
 * The handler as a cold start loads it when its registration logs a debug line and then fails. No failure the real
 * registration throws follows a buffered line, so this one is staged.
 */
function loadHandlerWhoseRegistrationFails(): Handler {
  let loaded: Handler | undefined;
  jest.isolateModules(() => {
    jest.doMock('../client-registration', () => ({
      ClientRegistration: class {
        constructor(
          _identityProvisioner: unknown,
          _cognito: unknown,
          _poolResolver: unknown,
          _redirectUriPolicy: unknown,
          private readonly logger: LoggerBuffer,
        ) {}

        async register(): Promise<never> {
          this.logger.debug('buffered_before_failure');
          throw new Error('unexpected failure');
        }
      },
    }));
    loaded = jest.requireActual<{ handler: Handler }>('../handler').handler;
  });
  if (loaded === undefined) {
    throw new Error('the handler was not loaded');
  }
  return loaded;
}

describe('jmap-oauth-dcr handler', () => {
  const lambdaMock = mockClient(LambdaClient);
  const cognitoMock = mockClient(CognitoIdentityProviderClient);
  let debugLog: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    lambdaMock.reset();
    cognitoMock.reset();
    cognitoMock.on(CreateUserPoolClientCommand).resolves({ UserPoolClient: { ClientId: 'new-client-id' } });
    debugLog = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers a client in the configured user pool, through the configured identity provisioner function', async () => {
    mockIdentityProvisioner(lambdaMock, {});

    const answer = await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'] }));

    expect(answer).toMatchObject({ statusCode: 201 });
    expect(lambdaMock.commandCalls(InvokeCommand).map((call) => call.args[0].input.FunctionName)).toEqual([
      'identity-provisioner-fn',
      'identity-provisioner-fn',
      'identity-provisioner-fn',
    ]);
    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)[0].args[0].input.UserPoolId).toBe('pool-1');
  });

  it('answers 500 server_error, never a registration, when identity-provisioner reports a duplicate without a client', async () => {
    mockIdentityProvisioner(lambdaMock, { dcrCheck: { status: 'dedup_hit', scope: 'openid email' } });

    const answer = await handler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'] }));

    expect(answer).toMatchObject({ statusCode: 500 });
    expect(errorLog).toHaveBeenCalledWith('jmap_oauth_dcr_unhandled_error', {
      error: expect.stringContaining('identity-provisioner returned an unexpected shape'),
    });
    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(0);
  });

  it('answers an unexpected failure with 500 server_error and writes the buffered trace that led to it', async () => {
    const failingHandler = loadHandlerWhoseRegistrationFails();

    const answer = await failingHandler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'] }));

    expect(answer).toMatchObject({
      statusCode: 500,
      body: JSON.stringify({ error: 'server_error', error_description: 'Internal error processing registration' }),
    });
    expect(errorLog).toHaveBeenCalledWith('jmap_oauth_dcr_unhandled_error', { error: 'Error: unexpected failure' });
    expect(debugLog).toHaveBeenCalledWith('buffered_before_failure');
  });
});
