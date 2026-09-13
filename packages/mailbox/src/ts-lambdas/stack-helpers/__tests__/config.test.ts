import { env } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { load } from '../config';

describe('stack-helpers config', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
  });

  it('loads all vars when set', () => {
    process.env.LOG_LEVEL = 'info';
    process.env.SERVICE_NAME = 'helpers-service';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'info',
        serviceName: 'helpers-service',
      },
      error: undefined,
    });
  });

  it('uses defaults when all vars absent', () => {
    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'error',
        serviceName: '',
      },
      error: undefined,
    });
  });
});
