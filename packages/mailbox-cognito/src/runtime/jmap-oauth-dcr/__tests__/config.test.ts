/// <reference types="jest" />

/**
 * Pins what this configuration adds to the shared base configuration: the user pool and the identity provisioner
 * function are mandatory alongside SERVICE_NAME. A Lambda that started without one of them would count a
 * registration against the tenant's cap before it failed, so each missing variable must be reported at load.
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

  it('loads the user pool, the identity provisioner function and the service name', () => {
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'fn-provisioner';
    process.env.USER_POOL_ID                       = 'pool-123';
    process.env.SERVICE_NAME                       = 'oauth-dcr-service';

    expect(env.tryLoad(load)).toEqual({
      config: {
        logLevel:                        'error',
        serviceName:                     'oauth-dcr-service',
        identityProvisionerFunctionName: 'fn-provisioner',
        userPoolId:                      'pool-123',
      },
      error:  undefined,
    });
  });

  it('reports both mandatory variables when they are missing', () => {
    const result = env.tryLoad(load);

    expect(result.error).toContain('IDENTITY_PROVISIONER_FUNCTION_NAME');
    expect(result.error).toContain('USER_POOL_ID');
  });

  it('reports SERVICE_NAME when it is missing', () => {
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'fn-provisioner';
    process.env.USER_POOL_ID                       = 'pool-123';

    expect(env.tryLoad(load).error).toContain('SERVICE_NAME');
  });
});
