/// <reference types="jest" />

/**
 * Pins the wiring of the DCR handler: that a registration runs against the user pool and the identity
 * provisioner function of its configuration, and what an unexpected failure answers. A failure nobody recognised
 * must answer 500 and write the buffered trace that led to it; without the trace, the log of the failing
 * invocation holds no more than the failure itself.
 */

import { CognitoIdentityProviderClient, CreateUserPoolClientCommand }  from '@aws-sdk/client-cognito-identity-provider';
import type * as CognitoSdk                                            from '@aws-sdk/client-cognito-identity-provider';
import { InvokeCommand, LambdaClient }                                 from '@aws-sdk/client-lambda';
import type * as LambdaSdk                                             from '@aws-sdk/client-lambda';
import type { LoggerBuffer }                                           from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                                  from 'aws-sdk-client-mock';

import type * as HandlerModule                                         from '../handler';

import { mockIdentityProvisioner, requestEvent }                       from './jmap-oauth-dcr-helpers';

type Handler = (typeof HandlerModule)['handler'];

const sharedLambdaSdk  = jest.requireActual<typeof LambdaSdk>('@aws-sdk/client-lambda');
const sharedCognitoSdk = jest.requireActual<typeof CognitoSdk>('@aws-sdk/client-cognito-identity-provider');

const MANDATORY_ENVIRONMENT = {
  IDENTITY_PROVISIONER_FUNCTION_NAME: 'identity-provisioner-fn',
  SERVICE_NAME:                       'jmap-oauth-dcr',
  USER_POOL_ID:                       'pool-1',
};

const UNEXPECTED_SHAPE_ERROR: unknown = expect.stringContaining('identity-provisioner returned an unexpected shape');

/**
 * The handler as a cold start loads it: the handler reads its configuration when it is loaded, so the mandatory
 * variables are set before it is.
 */
function loadHandler(stage: () => void = () => undefined): Handler {
  const saved = { ...process.env };
  let loaded: Handler | undefined;
  try {
    Object.assign(process.env, MANDATORY_ENVIRONMENT);
    jest.isolateModules(() => {
      // The isolated registry would load its own SDK clients, which the clients mocked below do not cover.
      jest.doMock('@aws-sdk/client-lambda', () => sharedLambdaSdk);
      jest.doMock('@aws-sdk/client-cognito-identity-provider', () => sharedCognitoSdk);
      stage();
      loaded = jest.requireActual<typeof HandlerModule>('../handler').handler;
    });
  } finally {
    process.env = saved;
  }
  if (loaded === undefined) {
    throw new Error('the handler was not loaded');
  }
  return loaded;
}

/**
 * The handler as a cold start loads it when its registration logs a debug line and then fails. No failure the real
 * registration throws follows a buffered line, so this one is staged.
 */
function loadHandlerWhoseRegistrationFails(): Handler {
  return loadHandler(() => {
    jest.doMock('../client-registration', () => ({
      ClientRegistration: class {
        private readonly logger: LoggerBuffer;

        constructor(...collaborators: [unknown, unknown, unknown, unknown, LoggerBuffer]) {
          this.logger = collaborators[4];
        }

        async register(): Promise<never> {
          this.logger.debug('buffered_before_failure');
          throw new Error('unexpected failure');
        }
      },
    }));
  });
}

describe('jmap-oauth-dcr handler', () => {
  const lambdaMock  = mockClient(LambdaClient);
  const cognitoMock = mockClient(CognitoIdentityProviderClient);
  let handler: Handler;
  let debugLog: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeAll(() => {
    handler = loadHandler();
  });

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
      error:   UNEXPECTED_SHAPE_ERROR,
      service: 'jmap-oauth-dcr',
    });
    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(0);
  });

  it('answers an unexpected failure with 500 server_error and writes the buffered trace that led to it', async () => {
    const failingHandler = loadHandlerWhoseRegistrationFails();

    const answer = await failingHandler(requestEvent({ redirect_uris: ['http://127.0.0.1/cb'] }));

    expect(answer).toMatchObject({
      statusCode: 500,
      body:       JSON.stringify({ error: 'server_error', error_description: 'Internal error processing registration' }),
    });
    expect(errorLog).toHaveBeenCalledWith('jmap_oauth_dcr_unhandled_error', { error: 'Error: unexpected failure', service: 'jmap-oauth-dcr' });
    expect(debugLog).toHaveBeenCalledWith('buffered_before_failure', { service: 'jmap-oauth-dcr' });
  });
});
