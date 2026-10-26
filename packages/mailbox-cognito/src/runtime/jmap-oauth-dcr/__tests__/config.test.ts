/// <reference types="jest" />

/**
 * Pins what this configuration adds to the shared base configuration: the user pool and the identity provisioner
 * function are mandatory. A Lambda that started without one of them would count a registration against the
 * tenant's cap before it failed, so each missing variable must be reported at load.
 */

import { env }  from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { load } from '../config';

describe('jmap-oauth-dcr config', () => {
  let originalEnvironment: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnvironment = { ...process.env };
    delete process.env.SERVICE_NAME;
    delete process.env.IDENTITY_PROVISIONER_FUNCTION_NAME;
    delete process.env.USER_POOL_ID;
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it('loads the user pool and the identity provisioner function', () => {
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'fn-provisioner';
    process.env.USER_POOL_ID                       = 'pool-123';
    process.env.SERVICE_NAME                       = 'oauth-dcr-service';

    const result = env.tryLoad(load);

    expect(result.error).toBeUndefined();
    expect(result.config).toMatchObject({ identityProvisionerFunctionName: 'fn-provisioner', userPoolId: 'pool-123' });
  });

  it('reports both mandatory variables when they are missing', () => {
    const result = env.tryLoad(load);

    expect(result.error).toContain('IDENTITY_PROVISIONER_FUNCTION_NAME');
    expect(result.error).toContain('USER_POOL_ID');
  });
});
