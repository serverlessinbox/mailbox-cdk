/// <reference types="jest" />

/**
 * Pins that the handler cannot be loaded without its mandatory configuration. The tenant's registration cap
 * counter is incremented on every request that is not a duplicate and is never decremented, so a Lambda that
 * started with a missing user pool or identity provisioner would burn the cap on every request and stay broken
 * for the rest of the period after the configuration was fixed. Failing the load fails the container before any
 * request, and so before any identity-provisioner invoke or Cognito call.
 *
 * Each case loads the handler in a fresh module registry, with the AWS clients mocked through the same registry.
 */

type LambdaSdk = typeof import('@aws-sdk/client-lambda');
type CognitoSdk = typeof import('@aws-sdk/client-cognito-identity-provider');
type ClientMock = typeof import('aws-sdk-client-mock');

describe('handler cold start with an invalid configuration', () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  /** Loads the handler and returns the number of AWS calls made while doing so; the load is expected to throw. */
  function loadHandlerAndCountAwsCalls(): { loadHandler: () => void; awsCalls: () => number } {
    const { LambdaClient, InvokeCommand }                                = jest.requireActual<LambdaSdk>('@aws-sdk/client-lambda');
    const { CognitoIdentityProviderClient, CreateUserPoolClientCommand } = jest.requireActual<CognitoSdk>('@aws-sdk/client-cognito-identity-provider');
    const { mockClient }                                                 = jest.requireActual<ClientMock>('aws-sdk-client-mock');
    const lambdaMock                                                     = mockClient(LambdaClient);
    const cognitoMock                                                    = mockClient(CognitoIdentityProviderClient);

    return {
      loadHandler: () => jest.requireActual('../handler'),
      awsCalls:    () => lambdaMock.commandCalls(InvokeCommand).length + cognitoMock.commandCalls(CreateUserPoolClientCommand).length,
    };
  }

  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])('throws naming USER_POOL_ID when it is %s, before any AWS call', (_label, value) => {
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'identity-provisioner-fn';
    if (value === undefined) {
      delete process.env.USER_POOL_ID;
    } else {
      process.env.USER_POOL_ID = value;
    }
    const { loadHandler, awsCalls } = loadHandlerAndCountAwsCalls();

    expect(loadHandler).toThrow(/USER_POOL_ID/);
    expect(awsCalls()).toBe(0);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])('throws naming IDENTITY_PROVISIONER_FUNCTION_NAME when it is %s, before any AWS call', (_label, value) => {
    if (value === undefined) {
      delete process.env.IDENTITY_PROVISIONER_FUNCTION_NAME;
    } else {
      process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = value;
    }
    process.env.USER_POOL_ID        = 'pool-1';
    const { loadHandler, awsCalls } = loadHandlerAndCountAwsCalls();

    expect(loadHandler).toThrow(/IDENTITY_PROVISIONER_FUNCTION_NAME/);
    expect(awsCalls()).toBe(0);
  });
});
