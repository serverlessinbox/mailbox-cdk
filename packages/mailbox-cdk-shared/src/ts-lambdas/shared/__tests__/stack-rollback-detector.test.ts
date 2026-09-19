import { isParentStackRollingBack } from '../stack-rollback-detector';
import { LoggerBuffer } from '../logger-buffer';

describe('isParentStackRollingBack', () => {
  describe('stack status detection with mock client', () => {
    it('returns true when stack status is UPDATE_ROLLBACK_IN_PROGRESS', async () => {
      const mockClient = {
        send: jest.fn(async () => ({
          Stacks: [{ StackStatus: 'UPDATE_ROLLBACK_IN_PROGRESS' }],
        })),
      };

      const result = await isParentStackRollingBack('arn:aws:cloudformation:...', mockClient as any);
      expect(result).toBe(true);
      expect(mockClient.send).toHaveBeenCalledTimes(1);
    });

    it('returns false when stack status is UPDATE_IN_PROGRESS', async () => {
      const mockClient = {
        send: jest.fn(async () => ({
          Stacks: [{ StackStatus: 'UPDATE_IN_PROGRESS' }],
        })),
      };

      const result = await isParentStackRollingBack('arn:aws:cloudformation:...', mockClient as any);
      expect(result).toBe(false);
    });

    it('returns false when stack status is CREATE_IN_PROGRESS', async () => {
      const mockClient = {
        send: jest.fn(async () => ({
          Stacks: [{ StackStatus: 'CREATE_IN_PROGRESS' }],
        })),
      };

      const result = await isParentStackRollingBack('arn:aws:cloudformation:...', mockClient as any);
      expect(result).toBe(false);
    });

    it('returns false when Stacks list is empty', async () => {
      const mockClient = {
        send: jest.fn(async () => ({ Stacks: [] })),
      };

      const result = await isParentStackRollingBack('arn:aws:cloudformation:...', mockClient as any);
      expect(result).toBe(false);
    });

    it('returns false when DescribeStacks throws an error', async () => {
      const mockClient = {
        send: jest.fn(async () => {
          throw new Error('Stack not found');
        }),
      };

      const result = await isParentStackRollingBack('arn:aws:cloudformation:...', mockClient as any);
      expect(result).toBe(false);
    });

    it('returns false when DescribeStacks throws AccessDenied', async () => {
      const mockClient = {
        send: jest.fn(async () => {
          throw new Error('AccessDenied');
        }),
      };

      const result = await isParentStackRollingBack('arn:aws:cloudformation:...', mockClient as any);
      expect(result).toBe(false);
    });
  });

  describe('logging via the buffered logger', () => {
    it('records the DescribeStacks failure on the caller-provided LoggerBuffer at warn level, not the console', async () => {
      const mockClient = {
        send: jest.fn(async () => {
          throw new Error('Stack not found');
        }),
      };
      const logger = new LoggerBuffer();
      const warnSpy = jest.spyOn(logger, 'warn');
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const result = await isParentStackRollingBack('arn:aws:cloudformation:...', mockClient as any, logger);

      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith('Failed to check parent stack status: Stack not found');
      // The default emit level is 'error', so a warn() call is buffered, not written immediately.
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('does not throw when no logger is provided on a DescribeStacks failure', async () => {
      const mockClient = {
        send: jest.fn(async () => {
          throw new Error('Stack not found');
        }),
      };

      await expect(
        isParentStackRollingBack('arn:aws:cloudformation:...', mockClient as any),
      ).resolves.toBe(false);
    });
  });
});
