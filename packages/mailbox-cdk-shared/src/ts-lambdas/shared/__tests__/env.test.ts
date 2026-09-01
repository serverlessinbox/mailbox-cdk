import { mustGet, get } from '../env';

describe('env helpers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original process.env
    process.env = originalEnv;
  });

  describe('mustGet', () => {
    it('returns the value when env var is set', () => {
      process.env.TEST_VAR = 'hello';
      expect(mustGet('TEST_VAR')).toBe('hello');
    });

    it('throws when env var is not set', () => {
      delete process.env.TEST_MISSING;
      expect(() => mustGet('TEST_MISSING')).toThrow('required environment variable TEST_MISSING is not set');
    });

    it('throws when env var is empty string', () => {
      process.env.TEST_EMPTY = '';
      expect(() => mustGet('TEST_EMPTY')).toThrow('required environment variable TEST_EMPTY is not set');
    });
  });

  describe('get', () => {
    it('returns the value when env var is set', () => {
      process.env.TEST_VAR = 'world';
      expect(get('TEST_VAR')).toBe('world');
    });

    it('returns undefined when env var is not set and no fallback provided', () => {
      delete process.env.TEST_MISSING;
      expect(get('TEST_MISSING')).toBeUndefined();
    });

    it('returns fallback when env var is not set', () => {
      delete process.env.TEST_MISSING;
      expect(get('TEST_MISSING', 'fallback')).toBe('fallback');
    });

    it('returns fallback when env var is empty string', () => {
      process.env.TEST_EMPTY = '';
      expect(get('TEST_EMPTY', 'fallback')).toBe('fallback');
    });

    it('returns fallback (undefined) when env var is empty string', () => {
      process.env.TEST_EMPTY = '';
      expect(get('TEST_EMPTY', undefined)).toBeUndefined();
    });

    it('returns value even if it is "0" or other falsy but present string', () => {
      process.env.TEST_ZERO = '0';
      expect(get('TEST_ZERO', 'fallback')).toBe('0');

      process.env.TEST_FALSE = 'false';
      expect(get('TEST_FALSE', 'fallback')).toBe('false');
    });
  });
});
