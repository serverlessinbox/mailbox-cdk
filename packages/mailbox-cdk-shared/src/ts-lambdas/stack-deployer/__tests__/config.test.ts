import * as env from '../../shared/env';
import { loadStarter, loadWorker } from '../config';

describe('stack-deployer config', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN;
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
    delete process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN;
  });

  describe('loadStarter', () => {
    it('loads all vars when set', () => {
      process.env.LOG_LEVEL = 'info';
      process.env.SERVICE_NAME = 'deployer-service';
      process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:deployer';

      const result = env.tryLoad(loadStarter);
      expect(result).toEqual({
        config: {
          logLevel: 'info',
          serviceName: 'deployer-service',
          stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:deployer',
        },
        error: undefined,
      });
    });

    it('reports error when mandatory var missing', () => {
      const result = env.tryLoad(loadStarter);
      expect(result.error).toContain('MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN');
    });

    it('uses the default log level when LOG_LEVEL is absent', () => {
      process.env.SERVICE_NAME = 'deployer-service';
      process.env.MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:deployer';

      const result = env.tryLoad(loadStarter);
      expect(result).toEqual({
        config: {
          logLevel: 'error',
          serviceName: 'deployer-service',
          stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:deployer',
        },
        error: undefined,
      });
    });
  });

  describe('loadWorker', () => {
    // The worker's CDK wrapper (stack-deployer-worker.ts) sets only SERVICE_NAME — never the
    // state machine ARN, which belongs to the starter alone. loadWorker must succeed on exactly
    // that environment; this is the litmus for the 2026-09-13 regression (worker demanded the
    // starter's env var and failed on every invocation).
    it('loads successfully with only SERVICE_NAME set (the worker Lambda\'s real environment)', () => {
      process.env.SERVICE_NAME = 'deployer-worker-service';

      const result = env.tryLoad(loadWorker);
      expect(result).toEqual({
        config: {
          logLevel: 'error',
          serviceName: 'deployer-worker-service',
        },
        error: undefined,
      });
    });

    it('reports SERVICE_NAME as missing when it is not set', () => {
      const result = env.tryLoad(loadWorker);
      expect(result.error).toContain('SERVICE_NAME');
    });

    it('never requires MAILBOX_STACK_DEPLOYER_STATE_MACHINE_ARN', () => {
      process.env.SERVICE_NAME = 'deployer-worker-service';

      const result = env.tryLoad(loadWorker);
      expect(result.error).toBeUndefined();
      expect(result.config).not.toHaveProperty('stateMachineArn');
    });

    it('loads all vars when set', () => {
      process.env.LOG_LEVEL = 'info';
      process.env.SERVICE_NAME = 'deployer-worker-service';

      const result = env.tryLoad(loadWorker);
      expect(result).toEqual({
        config: {
          logLevel: 'info',
          serviceName: 'deployer-worker-service',
        },
        error: undefined,
      });
    });
  });
});
