/// <reference types="jest" />

/**
 * Pins what this Lambda adds to the shared base configuration: three mandatory variables, optional admin and
 * user group lists that must be JSON arrays of strings, and a service name that may be absent. The base configuration
 * is tested beside it. A variable read as optional would start a Lambda that fails on its first request, and a
 * group list accepted with a non-string in it would hand the provisioning a name it cannot compare.
 */

import { env }  from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { load } from '../config';

const VARIABLES = ['SERVICE_NAME', 'USER_POOL_ID', 'AUDIT_EVENTS_QUEUE_URL', 'IDENTITY_PROVISIONER_FUNCTION_NAME', 'ADMIN_GROUPS', 'USER_GROUPS'];

function setMandatoryVariables(): void {
  process.env.USER_POOL_ID                       = 'pool-123';
  process.env.AUDIT_EVENTS_QUEUE_URL             = 'https://sqs.us-east-1.amazonaws.com/123/audit';
  process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'identity-provisioner';
}

describe('cognito-idp-users-api config', () => {
  beforeEach(() => {
    VARIABLES.forEach((variable) => delete process.env[variable]);
  });

  afterEach(() => {
    VARIABLES.forEach((variable) => delete process.env[variable]);
  });

  it('loads the variables it adds', () => {
    setMandatoryVariables();
    process.env.ADMIN_GROUPS = '["admin","superuser"]';
    process.env.USER_GROUPS  = '["user","viewer"]';

    expect(env.tryLoad(load)).toMatchObject({
      config: {
        userPoolId:                      'pool-123',
        auditEventsQueueUrl:             'https://sqs.us-east-1.amazonaws.com/123/audit',
        identityProvisionerFunctionName: 'identity-provisioner',
        adminGroups:                     ['admin', 'superuser'],
        userGroups:                      ['user', 'viewer'],
      },
      error:  undefined,
    });
  });

  it('reports every mandatory variable that is missing', () => {
    const { error } = env.tryLoad(load);

    expect(error).toContain('USER_POOL_ID');
    expect(error).toContain('AUDIT_EVENTS_QUEUE_URL');
    expect(error).toContain('IDENTITY_PROVISIONER_FUNCTION_NAME');
  });

  it('loads without the group lists and without a service name', () => {
    setMandatoryVariables();

    expect(env.tryLoad(load)).toMatchObject({
      config: { serviceName: '', adminGroups: undefined, userGroups: undefined },
      error:  undefined,
    });
  });

  it('loads the service name when SERVICE_NAME is set', () => {
    setMandatoryVariables();
    process.env.SERVICE_NAME = 'cognito-idp-users-api';

    expect(env.tryLoad(load).config.serviceName).toBe('cognito-idp-users-api');
  });

  it.each(['["admin", 1]', 'admin'])('rejects ADMIN_GROUPS set to %s', (value) => {
    setMandatoryVariables();
    process.env.ADMIN_GROUPS = value;

    expect(env.tryLoad(load).error).toContain('ADMIN_GROUPS');
  });

  it('rejects USER_GROUPS set to a list with a non-string in it', () => {
    setMandatoryVariables();
    process.env.USER_GROUPS = '["user", 1]';

    expect(env.tryLoad(load).error).toContain('USER_GROUPS');
  });
});
