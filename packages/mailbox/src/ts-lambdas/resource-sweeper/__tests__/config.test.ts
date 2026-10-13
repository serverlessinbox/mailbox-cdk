/**
 * Coverage for the resource-sweeper config loaders. The starter and worker Lambdas share one code
 * bundle but are two deployed functions with different environments: only the starter's carries the
 * state machine ARN. If the worker's config demanded it, the worker would fail on every invocation;
 * if the starter's did not, a starter without it would only fail when it tried to start a sweep.
 */

import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { loadStarter, loadWorker } from '../config';

const STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:test';

describe('resource-sweeper config', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN;
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN;
  });

  describe('loadStarter', () => {
    it('loads all vars when set', () => {
      process.env.LOG_LEVEL = 'info';
      process.env.SERVICE_NAME = 'sweeper-service';
      process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = STATE_MACHINE_ARN;

      expect(env.tryLoad(loadStarter)).toEqual({
        config: { logLevel: 'info', serviceName: 'sweeper-service', sweeperStateMachineArn: STATE_MACHINE_ARN },
        error: undefined,
      });
    });

    it('defaults the log level to error', () => {
      process.env.SERVICE_NAME = 'sweeper-service';
      process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = STATE_MACHINE_ARN;

      expect(env.tryLoad(loadStarter).config.logLevel).toBe('error');
    });

    it('reports the state machine ARN as missing when it is not set', () => {
      process.env.SERVICE_NAME = 'sweeper-service';

      expect(env.tryLoad(loadStarter).error).toContain('MAILBOX_SWEEPER_STATE_MACHINE_ARN');
    });

    it('reports SERVICE_NAME as missing when it is not set', () => {
      process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = STATE_MACHINE_ARN;

      expect(env.tryLoad(loadStarter).error).toContain('SERVICE_NAME');
    });

    it('reports an unrecognised LOG_LEVEL rather than falling back to the default', () => {
      process.env.SERVICE_NAME = 'sweeper-service';
      process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = STATE_MACHINE_ARN;
      process.env.LOG_LEVEL = 'verbose';

      expect(env.tryLoad(loadStarter).error).toContain('LOG_LEVEL');
    });
  });

  describe('loadWorker', () => {
    it('loads with only SERVICE_NAME set, defaulting the log level to error', () => {
      process.env.SERVICE_NAME = 'resource-sweeper-worker';

      const result = env.tryLoad(loadWorker);

      expect(result).toEqual({
        config: { logLevel: 'error', serviceName: 'resource-sweeper-worker' },
        error: undefined,
      });
      expect(result.config).not.toHaveProperty('sweeperStateMachineArn');
    });

    it('reports SERVICE_NAME as missing when it is not set', () => {
      expect(env.tryLoad(loadWorker).error).toContain('SERVICE_NAME');
    });

    it('reports an unrecognised LOG_LEVEL rather than falling back to the default', () => {
      process.env.SERVICE_NAME = 'resource-sweeper-worker';
      process.env.LOG_LEVEL = 'verbose';

      expect(env.tryLoad(loadWorker).error).toContain('LOG_LEVEL');
    });
  });
});
