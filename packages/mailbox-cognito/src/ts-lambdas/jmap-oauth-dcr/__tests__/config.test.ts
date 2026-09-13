import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from '../config';

describe('jmap-oauth-dcr config', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.IDENTITY_PROVISIONER_FUNCTION_NAME;
    delete process.env.USER_POOL_ID;
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.IDENTITY_PROVISIONER_FUNCTION_NAME;
    delete process.env.USER_POOL_ID;
  });

  it('loads all vars when set', () => {
    process.env.LOG_LEVEL = 'info';
    process.env.SERVICE_NAME = 'oauth-dcr-service';
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'fn-provisioner';
    process.env.USER_POOL_ID = 'pool-123';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'info',
        serviceName: 'oauth-dcr-service',
        identityProvisionerFunctionName: 'fn-provisioner',
        userPoolId: 'pool-123',
      },
      error: undefined,
    });
  });

  it('reports error when mandatory vars missing', () => {
    const result = env.tryLoad(load);
    expect(result.error).toContain('IDENTITY_PROVISIONER_FUNCTION_NAME');
    expect(result.error).toContain('USER_POOL_ID');
  });

  it('uses defaults when all optionals absent', () => {
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'fn-provisioner';
    process.env.USER_POOL_ID = 'pool-123';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'error',
        serviceName: '',
        identityProvisionerFunctionName: 'fn-provisioner',
        userPoolId: 'pool-123',
      },
      error: undefined,
    });
  });
});
