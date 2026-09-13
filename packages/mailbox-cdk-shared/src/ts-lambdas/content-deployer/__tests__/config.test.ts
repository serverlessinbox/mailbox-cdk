import { tryLoad } from '../../shared/env';
import { load } from '../config';

describe('content-deployer config', () => {
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

  it('uses defaults when all vars absent', () => {
    const result = tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'error',
        serviceName: '',
      },
      error: undefined,
    });
  });
});
