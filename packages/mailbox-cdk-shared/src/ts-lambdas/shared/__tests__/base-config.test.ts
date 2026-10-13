/**
 * Pins the environment every Lambda shares: SERVICE_NAME is mandatory and LOG_LEVEL is optional but strictly
 * parsed, so a mistyped level is reported instead of silently replaced by the default. A Lambda that only
 * reads these variables has no config of its own, so a regression here reaches all of them.
 */

import { loadBaseConfig, loadLogLevel } from '../base-config';
import { tryLoad } from '../env';

describe('base config', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.SERVICE_NAME;
  });

  describe('loadBaseConfig', () => {
    it('loads both variables when set', () => {
      process.env.LOG_LEVEL = 'info';
      process.env.SERVICE_NAME = 'test-service';

      expect(tryLoad(loadBaseConfig)).toEqual({
        config: { logLevel: 'info', serviceName: 'test-service' },
        error: undefined,
      });
    });

    it('defaults the log level to error when LOG_LEVEL is absent', () => {
      process.env.SERVICE_NAME = 'test-service';

      expect(tryLoad(loadBaseConfig).config.logLevel).toBe('error');
    });

    it('reports SERVICE_NAME as missing when it is not set', () => {
      expect(tryLoad(loadBaseConfig).error).toContain('SERVICE_NAME');
    });
  });

  describe('loadLogLevel', () => {
    it('reports a LOG_LEVEL that is not a log level rather than falling back to the default', () => {
      process.env.LOG_LEVEL = 'verbose';

      expect(tryLoad(loadLogLevel).error).toContain('LOG_LEVEL');
    });

    it('accepts a log level in any case', () => {
      process.env.LOG_LEVEL = 'WARN';

      expect(tryLoad(loadLogLevel)).toEqual({ config: 'warn', error: undefined });
    });
  });
});
