/// <reference types="jest" />

/**
 * Pins the level rule of LoggerBuffer: an entry at or above the emit level is written once and at once, a lower
 * entry is written only by a flush, and the service field is attached on both paths. Loosening any of these either
 * floods CloudWatch on healthy invocations or loses the trace of a failed one.
 */

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
    jest.restoreAllMocks();
  });

  describe('service field', () => {
    it('is attached to the data of an entry written at once', () => {
      const logger = new LoggerBuffer('my-lambda', 'error');
      logger.error('test message', { foo: 'bar' });

      expect(consoleErrorSpy).toHaveBeenCalledWith('test message', { foo: 'bar', service: 'my-lambda' });
    });

    it('is attached to the data of a buffered entry when it is flushed', () => {
      const logger = new LoggerBuffer('my-service', 'error');
      logger.info('info message', { data: 'value' });
      logger.flush();

      expect(consoleInfoSpy).toHaveBeenCalledWith('info message', { data: 'value', service: 'my-service' });
    });

    it('is absent when no service is set', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.error('test message', { foo: 'bar' });

      expect(consoleErrorSpy).toHaveBeenCalledWith('test message', { foo: 'bar' });
    });
  });

  describe('default emit level', () => {
    it('is error when no level is given', () => {
      const logger = new LoggerBuffer('my-service');
      logger.warn('warn message');
      logger.error('error message');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message', { service: 'my-service' });
    });

    it('writes an error at once and does not buffer it', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.error('error message');

      expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
    });

    it('buffers warn, info and debug without writing them', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('writes the buffered entries on flush and empties the buffer', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');

      logger.flush();

      expect(consoleDebugSpy).toHaveBeenCalledWith('debug message');
      expect(consoleInfoSpy).toHaveBeenCalledWith('info message');
      expect(consoleWarnSpy).toHaveBeenCalledWith('warn message');
    });

    it('does not write an error a second time on flush', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.error('error message');
      logger.flush();

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('does not write the buffered entries again on a second flush', () => {
      const logger = new LoggerBuffer(undefined, 'error');
      logger.info('info message');
      logger.flush();
      logger.flush();

      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('emit level debug', () => {
    it('writes every level at once, buffers nothing and leaves flush with nothing to write', () => {
      const logger = new LoggerBuffer(undefined, 'debug');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      logger.flush();

      expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('emit level warn', () => {
    it('writes warn and error at once and flushes only the buffered debug and info', () => {
      const logger = new LoggerBuffer(undefined, 'warn');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      logger.flush();

      expect(consoleDebugSpy).toHaveBeenCalledWith('debug message');
      expect(consoleInfoSpy).toHaveBeenCalledWith('info message');
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

});

describe('parseLogLevelStrict', () => {
  it.each(['debug', 'info', 'warn', 'error'] as const)('parses %s', (level) => {
    expect(parseLogLevelStrict(level)).toBe(level);
  });

  it('parses levels case-insensitively', () => {
    expect(parseLogLevelStrict('DEBUG')).toBe('debug');
    expect(parseLogLevelStrict('WaRn')).toBe('warn');
  });

  it.each(['verbose', 'trace', '1', ''])('rejects the level string %j', (raw) => {
    expect(() => parseLogLevelStrict(raw)).toThrow(`Invalid log level: '${raw}' is not one of debug, info, warn, error`);
  });

  it.each([123, null, undefined])('rejects the non-string value %p', (raw) => {
    expect(() => Reflect.apply(parseLogLevelStrict, undefined, [raw])).toThrow(/expected string/);
  });
});
