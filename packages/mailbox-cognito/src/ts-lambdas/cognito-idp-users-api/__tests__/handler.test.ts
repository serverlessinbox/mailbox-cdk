/// <reference types="jest" />

/**
 * Pins the entry wiring of the IdP users API Lambda: an incomplete environment stops the cold start, the health
 * probe reflects the environment it is asked in, and a real event reaches the admin API. Without the first, the
 * Lambda starts and fails every request; without the second, the auto-updater would keep code that cannot run.
 *
 * The environment is read when the handler module loads, so it is set before the module is imported.
 */

const MANDATORY_VARIABLES = ['USER_POOL_ID', 'AUDIT_EVENTS_QUEUE_URL', 'IDENTITY_PROVISIONER_FUNCTION_NAME'];

function setValidEnvironment(): void {
  process.env.USER_POOL_ID = 'pool-1';
  process.env.AUDIT_EVENTS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/audit-events';
  process.env.IDENTITY_PROVISIONER_FUNCTION_NAME = 'identity-provisioner';
  process.env.ADMIN_GROUPS = JSON.stringify(['admin']);
  process.env.USER_GROUPS = JSON.stringify(['user']);
}

setValidEnvironment();

import * as lambdaRuntime from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { handler } from '../handler';

describe('IdP users API handler', () => {
  afterEach(() => {
    setValidEnvironment();
  });

  it('answers a health probe as healthy when the environment is complete', async () => {
    const probe: lambdaRuntime.SmokeTestProbe = { serverlessInboxSmokeTest: true };

    expect(await handler(probe)).toEqual({ serverlessInboxSmokeTestOk: true });
  });

  it('answers a health probe as unhealthy when a variable of the environment is gone', async () => {
    delete process.env.USER_POOL_ID;
    const probe: lambdaRuntime.SmokeTestProbe = { serverlessInboxSmokeTest: true };

    expect(await handler(probe)).toEqual({ serverlessInboxSmokeTestOk: false });
  });

  it('hands a real event to the admin API', async () => {
    const result = await handler({ requestContext: { http: { method: 'GET' } } });

    expect(result).toMatchObject({ statusCode: 405 });
  });

  it('builds its logger with the configured service name and log level', () => {
    const actualRuntime = jest.requireActual<typeof lambdaRuntime>('@serverlessinbox/mailbox-cdk-shared/lambda-runtime');
    const loggerBuffer = jest.fn((...args: ConstructorParameters<typeof lambdaRuntime.LoggerBuffer>) => new actualRuntime.LoggerBuffer(...args));
    const saved = { ...process.env };
    try {
      process.env.SERVICE_NAME = 'cognito-idp-users-api';
      process.env.LOG_LEVEL = 'warn';
      jest.isolateModules(() => {
        jest.doMock('@serverlessinbox/mailbox-cdk-shared/lambda-runtime', () => ({ ...actualRuntime, LoggerBuffer: loggerBuffer }));
        require('../handler');
      });
    } finally {
      process.env = saved;
    }

    expect(loggerBuffer).toHaveBeenCalledWith('cognito-idp-users-api', 'warn');
  });

  it.each(MANDATORY_VARIABLES)('stops the cold start, naming %s, when it is missing', (variable) => {
    const saved = { ...process.env };
    try {
      jest.isolateModules(() => {
        delete process.env[variable];

        expect(() => require('../handler')).toThrow(variable);
      });
    } finally {
      process.env = saved;
    }
  });
});
