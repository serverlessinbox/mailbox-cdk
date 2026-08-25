/// <reference types="jest" />

/**
 * Regression test for the cap-burn bug: previously `USER_POOL_ID` was read (and could throw)
 * lazily inside `processRegistration`, *after* `identityProvisioner.dcrCheck(...)` had already
 * incremented the tenant's per-24h registration cap counter (never decremented — binding
 * decision #5). A misconfigured deployment therefore burned the cap on every request and stayed
 * broken for the rest of the period even once the config was fixed.
 *
 * This drives the REAL `../handler` module (which pulls in the real `../config`,
 * `../pool-resolver`, `../identity-provisioner-client`, `../cognito-client`) with a required env
 * var missing/empty, and proves that in that state the module cannot even be loaded — so there
 * is no code path left by which `dcrCheck` (or any Cognito call) could run.
 *
 * Each case re-requires everything (SDK client classes included) fresh, post-`resetModules()`,
 * so the mocks bind to the same class objects the freshly-loaded `../handler` would use if it
 * got far enough to construct a client (it doesn't — the point of this test is that it can't).
 */
describe('cold-start fail-fast: no identity-provisioner invoke, no Cognito call when config is invalid', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it.each([
    ['missing', undefined],
    ['empty string', ''],
  ] as const)('USER_POOL_ID %s: importing ../handler throws before any AWS call is possible', (_label: string, value: string | undefined) => {
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'identity-provisioner-fn';
    if (value === undefined) {
      delete process.env.USER_POOL_ID;
    } else {
      process.env.USER_POOL_ID = value;
    }

    const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
    const { CognitoIdentityProviderClient, CreateUserPoolClientCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const { mockClient } = require('aws-sdk-client-mock');
    const lambdaMock = mockClient(LambdaClient);
    const cognitoMock = mockClient(CognitoIdentityProviderClient);

    expect(() => {
      require('../handler');
    }).toThrow(/USER_POOL_ID is not configured/);

    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(0);
  });

  it.each([
    ['missing', undefined],
    ['empty string', ''],
  ] as const)('IDENTITY_PROVISIONER_FUNCTION_NAME %s: importing ../handler throws before any AWS call is possible', (_label: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env.IDENTITY_PROVISIONER_FUNCTION_NAME;
    } else {
      process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = value;
    }
    process.env.USER_POOL_ID = 'pool-1';

    const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
    const { CognitoIdentityProviderClient, CreateUserPoolClientCommand } = require('@aws-sdk/client-cognito-identity-provider');
    const { mockClient } = require('aws-sdk-client-mock');
    const lambdaMock = mockClient(LambdaClient);
    const cognitoMock = mockClient(CognitoIdentityProviderClient);

    expect(() => {
      require('../handler');
    }).toThrow(/IDENTITY_PROVISIONER_FUNCTION_NAME is not configured/);

    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
    expect(cognitoMock.commandCalls(CreateUserPoolClientCommand)).toHaveLength(0);
  });
});
