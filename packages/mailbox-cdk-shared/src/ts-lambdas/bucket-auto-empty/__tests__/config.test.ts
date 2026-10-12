import { tryLoad } from '../../shared/env';
import { load } from '../config';

describe('bucket-auto-empty config', () => {
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
    process.env.SERVICE_NAME = 'test-service';

    const result = tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'info',
        serviceName: 'test-service',
      },
      error: undefined,
    });
  });

  it('uses the default log level when LOG_LEVEL is absent', () => {
    process.env.SERVICE_NAME = 'test-service';

    const result = tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'error',
        serviceName: 'test-service',
      },
      error: undefined,
    });
  });

  it('reports SERVICE_NAME as missing when it is not set', () => {
    const result = tryLoad(load);
    expect(result.error).toContain('SERVICE_NAME');
  });
});
