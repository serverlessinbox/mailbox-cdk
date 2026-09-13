/// <reference types="jest" />

import { LoggerBuffer, parseLogLevelStrict } from '../logger-buffer';

describe('LoggerBuffer', () => {
  let consoleDebugSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('service field emission', () => {
    it('emits service field when service is set', () => {
      const logger = new LoggerBuffer('my-lambda', 'error');
      logger.error('test message', { foo: 'bar' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'test message',
        expect.objectContaining({
          foo: 'bar',
          service: 'my-lambda',
        })
      );
    });

    it('omits service field when service is not set', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.error('test message', { foo: 'bar' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'test message',
        { foo: 'bar' }
      );
      // Verify service field is NOT present
      const callArgs = consoleErrorSpy.mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('service');
    });

    it('preserves existing data when attaching service field', () => {
      const logger = new LoggerBuffer('my-service', 'error');
      const data = { key1: 'value1', key2: 42, nested: { deep: true } };

      logger.error('test', data);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          key1: 'value1',
          key2: 42,
          nested: { deep: true },
          service: 'my-service',
        })
      );
    });
  });

  describe('level-based filtering with default emitLevel=error', () => {
    it('emits error immediately and does not buffer it', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.error('error message');

      expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
      expect(logger.stats().entries).toBe(0); // Not buffered
    });

    it('buffers warn, info, debug and does not emit without flush', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(logger.stats().entries).toBe(3); // All three are buffered
    });

    it('flushes buffered entries after buffer', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');

      logger.flush();

      expect(consoleDebugSpy).toHaveBeenCalledWith('debug message');
      expect(consoleInfoSpy).toHaveBeenCalledWith('info message');
      expect(consoleWarnSpy).toHaveBeenCalledWith('warn message');
      expect(logger.stats().entries).toBe(0); // Buffer cleared
    });

    it('does not emit error again on flush', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.error('error message');
      logger.flush();

      // error was emitted immediately, flush should not emit it again
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('emits errors immediately even with buffered trace', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.info('preceding info');
      logger.warn('preceding warn');
      logger.error('error happens');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('error happens');
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('flushes trace when shouldFlush indicates error', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.info('info 1');
      logger.warn('info 2');
      logger.error('error message');

      expect(logger.shouldFlush()).toBe(true);
      logger.flush();

      expect(consoleInfoSpy).toHaveBeenCalledWith('info 1');
      expect(consoleWarnSpy).toHaveBeenCalledWith('info 2');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1); // Already emitted
    });
  });

  describe('emitLevel=debug', () => {
    it('emits all levels immediately and buffer stays empty', () => {
      const logger = new LoggerBuffer(undefined, 'debug');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleDebugSpy).toHaveBeenCalledWith('debug message');
      expect(consoleInfoSpy).toHaveBeenCalledWith('info message');
      expect(consoleWarnSpy).toHaveBeenCalledWith('warn message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
      expect(logger.stats().entries).toBe(0); // Nothing buffered
    });

    it('flush does not emit anything when all were immediate', () => {
      const logger = new LoggerBuffer(undefined, 'debug');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      logger.flush();

      // Only the immediate emissions, no additional calls from flush
      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('emitLevel=warn', () => {
    it('emits warn and error immediately, buffers debug and info', () => {
      const logger = new LoggerBuffer(undefined, 'warn');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith('warn message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
      expect(logger.stats().entries).toBe(2); // debug and info buffered
    });

    it('flushes debug and info after buffer', () => {
      const logger = new LoggerBuffer(undefined, 'warn');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      logger.flush();

      expect(consoleDebugSpy).toHaveBeenCalledWith('debug message');
      expect(consoleInfoSpy).toHaveBeenCalledWith('info message');
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1); // Only immediate
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1); // Only immediate
    });
  });

  describe('service attachment on both immediate and buffered paths', () => {
    it('attaches service to immediately emitted entries', () => {
      const logger = new LoggerBuffer('my-service', 'warn');
      logger.warn('warn message', { data: 'value' });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'warn message',
        expect.objectContaining({
          data: 'value',
          service: 'my-service',
        })
      );
    });

    it('attaches service to buffered entries on flush', () => {
      const logger = new LoggerBuffer('my-service', 'error');
      logger.info('info message', { data: 'value' });
      logger.flush();

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        'info message',
        expect.objectContaining({
          data: 'value',
          service: 'my-service',
        })
      );
    });
  });

  describe('error tracking for shouldFlush', () => {
    it('error increments counter even though it is emitted immediately', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      expect(logger.shouldFlush()).toBe(false);

      logger.error('something went wrong');
      expect(logger.shouldFlush()).toBe(true);
      expect(logger.stats().errors).toBe(1);
    });

    it('recordUpdate increments counter and shouldFlush', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      expect(logger.shouldFlush()).toBe(false);

      logger.recordUpdate();
      expect(logger.shouldFlush()).toBe(true);
      expect(logger.stats().updates).toBe(1);
    });

    it('shouldFlush true when both update and error have occurred', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.recordUpdate();
      logger.error('error message');

      expect(logger.shouldFlush()).toBe(true);
      expect(logger.stats().updates).toBe(1);
      expect(logger.stats().errors).toBe(1);
    });
  });

  describe('parseLogLevelStrict', () => {
    it('parses all valid levels', () => {
      expect(parseLogLevelStrict('debug')).toBe('debug');
      expect(parseLogLevelStrict('info')).toBe('info');
      expect(parseLogLevelStrict('warn')).toBe('warn');
      expect(parseLogLevelStrict('error')).toBe('error');
    });

    it('parses levels case-insensitively', () => {
      expect(parseLogLevelStrict('DEBUG')).toBe('debug');
      expect(parseLogLevelStrict('Info')).toBe('info');
      expect(parseLogLevelStrict('WARN')).toBe('warn');
      expect(parseLogLevelStrict('Error')).toBe('error');
      expect(parseLogLevelStrict('WaRn')).toBe('warn');
    });

    it('rejects invalid level strings', () => {
      expect(() => parseLogLevelStrict('verbose')).toThrow(
        /Invalid log level/
      );
      expect(() => parseLogLevelStrict('trace')).toThrow(
        /Invalid log level/
      );
      expect(() => parseLogLevelStrict('1')).toThrow(
        /Invalid log level/
      );
      expect(() => parseLogLevelStrict('')).toThrow(
        /Invalid log level/
      );
    });

    it('rejects non-string input', () => {
      expect(() => parseLogLevelStrict(123 as any)).toThrow(
        /expected string/
      );
      expect(() => parseLogLevelStrict(null as any)).toThrow(
        /expected string/
      );
      expect(() => parseLogLevelStrict(undefined as any)).toThrow(
        /expected string/
      );
    });
  });

  describe('backward compatibility', () => {
    it('defaults to error level when no level specified', () => {
      const logger = new LoggerBuffer('my-service');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'error message',
        expect.objectContaining({
          service: 'my-service',
        })
      );
    });

    it('defaults to error level when service only', () => {
      const logger = new LoggerBuffer('my-service');
      logger.debug('debug message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(logger.stats().entries).toBe(1);
    });

    it('allows no service, no level (full defaults)', () => {
      const logger = new LoggerBuffer();
      logger.error('error message');

      expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
    });
  });
});
