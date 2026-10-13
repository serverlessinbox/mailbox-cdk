/**
 * Pins the environment the stack-helpers Lambda reads. The smoke-test probe and the handler both
 * rely on a missing SERVICE_NAME or an unknown LOG_LEVEL being reported, not defaulted.
 */

import * as env from '../../shared/env';
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

  it('uses the default log level when LOG_LEVEL is absent', () => {
    process.env.SERVICE_NAME = 'helpers-service';

    const result = env.tryLoad(load);
    expect(result).toEqual({
      config: {
        logLevel: 'error',
        serviceName: 'helpers-service',
      },
      error: undefined,
    });
  });

  it('reports an unknown LOG_LEVEL', () => {
    process.env.SERVICE_NAME = 'helpers-service';
    process.env.LOG_LEVEL = 'verbose';

    const result = env.tryLoad(load);

    expect(result.error).toContain('LOG_LEVEL');
  });

  it('reports SERVICE_NAME as missing when it is not set', () => {
    const result = env.tryLoad(load);
    expect(result.error).toContain('SERVICE_NAME');
  });
});
