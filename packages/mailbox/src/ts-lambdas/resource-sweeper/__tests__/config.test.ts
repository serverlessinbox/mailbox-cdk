import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { loadStarter, loadWorker } from '../config';

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
      process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:test';

      const result = env.tryLoad(loadStarter);
      expect(result).toEqual({
        config: {
          logLevel: 'info',
          serviceName: 'sweeper-service',
          sweeperStateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:test',
        },
        error: undefined,
      });
    });

    it('reports error when mandatory var missing', () => {
      const result = env.tryLoad(loadStarter);
      expect(result.error).toContain('MAILBOX_SWEEPER_STATE_MACHINE_ARN');
    });

    it('uses defaults when all optionals absent', () => {
      process.env.MAILBOX_SWEEPER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:test';

      const result = env.tryLoad(loadStarter);
      expect(result).toEqual({
        config: {
          logLevel: 'error',
          serviceName: '',
          sweeperStateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:test',
        },
        error: undefined,
      });
    });
  });

  describe('loadWorker', () => {
    // The worker's CDK wrapper (resource-sweeper-worker.ts) sets no env vars beyond SERVICE_NAME —
    // never the sweeper state machine ARN, which belongs to the starter alone. This is the litmus
    // for the 2026-09-13 regression (worker demanded the starter's env var and failed on every
    // invocation).
    it('loads successfully with only SERVICE_NAME set (the worker Lambda\'s real environment)', () => {
      process.env.SERVICE_NAME = 'resource-sweeper-worker';

      const result = env.tryLoad(loadWorker);
      expect(result).toEqual({
        config: {
          logLevel: 'error',
          serviceName: 'resource-sweeper-worker',
        },
        error: undefined,
      });
    });

    it('never requires MAILBOX_SWEEPER_STATE_MACHINE_ARN', () => {
      const result = env.tryLoad(loadWorker);
      expect(result.error).toBeUndefined();
      expect(result.config).not.toHaveProperty('sweeperStateMachineArn');
    });
  });
});
