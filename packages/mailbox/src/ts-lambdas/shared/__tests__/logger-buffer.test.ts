/// <reference types="jest" />

import { LoggerBuffer } from '../logger-buffer';

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
      const logger = new LoggerBuffer('my-lambda');
      logger.info('test message', { foo: 'bar' });
      logger.flush();

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        'test message',
        expect.objectContaining({
          foo: 'bar',
          service: 'my-lambda',
        })
      );
    });

    it('omits service field when service is not set', () => {
      const logger = new LoggerBuffer();
      logger.info('test message', { foo: 'bar' });
      logger.flush();

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        'test message',
        { foo: 'bar' }
      );
      // Verify service field is NOT present
      const callArgs = consoleInfoSpy.mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('service');
    });

    it('works for all log levels when service is set', () => {
      const logger = new LoggerBuffer('test-service');

      logger.debug('debug message', { level: 'debug' });
      logger.info('info message', { level: 'info' });
      logger.warn('warn message', { level: 'warn' });
      logger.error('error message', { level: 'error' });

      logger.flush();

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'debug message',
        expect.objectContaining({ level: 'debug', service: 'test-service' })
      );
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        'info message',
        expect.objectContaining({ level: 'info', service: 'test-service' })
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'warn message',
        expect.objectContaining({ level: 'warn', service: 'test-service' })
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'error message',
        expect.objectContaining({ level: 'error', service: 'test-service' })
      );
    });

    it('works for all log levels when service is not set', () => {
      const logger = new LoggerBuffer();

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      logger.flush();

      expect(consoleDebugSpy).toHaveBeenCalledWith('debug message');
      expect(consoleInfoSpy).toHaveBeenCalledWith('info message');
      expect(consoleWarnSpy).toHaveBeenCalledWith('warn message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('error message');
    });

    it('preserves existing data when attaching service field', () => {
      const logger = new LoggerBuffer('my-service');
      const data = { key1: 'value1', key2: 42, nested: { deep: true } };

      logger.info('test', data);
      logger.flush();

      expect(consoleInfoSpy).toHaveBeenCalledWith(
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

  describe('buffering behavior', () => {
    it('buffers logs without flushing', () => {
      const logger = new LoggerBuffer('test-service');

      logger.info('message 1');
      logger.info('message 2');

      expect(consoleInfoSpy).not.toHaveBeenCalled();

      logger.flush();

      expect(consoleInfoSpy).toHaveBeenCalledTimes(2);
    });

    it('shouldFlush returns true when there are updates', () => {
      const logger = new LoggerBuffer();
      expect(logger.shouldFlush()).toBe(false);

      logger.recordUpdate();
      expect(logger.shouldFlush()).toBe(true);
    });

    it('shouldFlush returns true when there are errors', () => {
      const logger = new LoggerBuffer();
      expect(logger.shouldFlush()).toBe(false);

      logger.error('something went wrong');
      expect(logger.shouldFlush()).toBe(true);
    });
  });
});
