import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from '../config';

describe('cognito-idp-users-api config', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.USER_POOL_ID;
    delete process.env.AUDIT_EVENTS_QUEUE_URL;
    delete process.env.IDENTITY_PROVISIONER_FUNCTION_NAME;
    delete process.env.ADMIN_GROUPS;
    delete process.env.USER_GROUPS;
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.USER_POOL_ID;
    delete process.env.AUDIT_EVENTS_QUEUE_URL;
    delete process.env.IDENTITY_PROVISIONER_FUNCTION_NAME;
    delete process.env.ADMIN_GROUPS;
    delete process.env.USER_GROUPS;
  });

  it('loads all vars when set with valid values', () => {
    process.env.LOG_LEVEL = 'info';
    process.env.USER_POOL_ID = 'pool-123';
    process.env.AUDIT_EVENTS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/audit';
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'identity-provisioner';
    process.env.ADMIN_GROUPS = '["admin","superuser"]';
    process.env.USER_GROUPS = '["user","viewer"]';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'info',
        userPoolId: 'pool-123',
        auditEventsQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/audit',
        identityProvisionerFunctionName: 'identity-provisioner',
        adminGroups: ['admin', 'superuser'],
        userGroups: ['user', 'viewer'],
      },
      error: undefined,
    });
  });

  it('reports error when mandatory vars missing', () => {
    const result = env.tryLoad(load);
    expect(result.error).toContain('USER_POOL_ID');
    expect(result.error).toContain('AUDIT_EVENTS_QUEUE_URL');
    expect(result.error).toContain('IDENTITY_PROVISIONER_FUNCTION_NAME');
  });

  it('uses defaults when all optionals absent', () => {
    process.env.USER_POOL_ID = 'pool-123';
    process.env.AUDIT_EVENTS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123/audit';
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'identity-provisioner';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'error',
        userPoolId: 'pool-123',
        auditEventsQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/audit',
        identityProvisionerFunctionName: 'identity-provisioner',
        adminGroups: undefined,
        userGroups: undefined,
      },
      error: undefined,
    });
  });

  it.each([
    { var: 'ADMIN_GROUPS', value: '["admin", 1]' },
    { var: 'USER_GROUPS', value: '[1, "user"]' },
  ])('rejects $var with array containing non-string', ({ var: varName, value }) => {
    process.env.USER_POOL_ID = 'pool-123';
    process.env.AUDIT_EVENTS_QUEUE_URL = 'queue-url';
    process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'identity-provisioner';
    process.env[varName] = value;

    const result = env.tryLoad(load);
    expect(result.error).toContain(varName);
  });
});
