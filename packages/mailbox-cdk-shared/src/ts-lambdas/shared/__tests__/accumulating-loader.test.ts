/**
 * Pins how the loader reads the environment: a variable that is unset, empty or whitespace-only counts as not set,
 * and every problem is collected and reported together. A loader that stopped at the first problem or accepted a
 * blank value would let a Lambda start with a half-configured environment.
 */

import { AccumulatingLoader } from '../accumulating-loader';

describe('AccumulatingLoader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('mandatory', () => {
    it('returns the value of a set variable and records nothing', () => {
      process.env.LOADER_VAR = 'alice';
      const loader = new AccumulatingLoader();

      expect(loader.mandatory('LOADER_VAR')).toBe('alice');
      expect(loader.error()).toBeUndefined();
    });

    it.each([undefined, '', '   '])('records a problem and returns the empty string when the variable is %j', (value) => {
      if (value === undefined) {
        delete process.env.LOADER_VAR;
      } else {
        process.env.LOADER_VAR = value;
      }
      const loader = new AccumulatingLoader();

      expect(loader.mandatory('LOADER_VAR')).toBe('');
      expect(loader.error()).toBe('LOADER_VAR is not set');
    });
  });

  describe('optional', () => {
    it('returns the value of a set variable', () => {
      process.env.LOADER_VAR = 'admin';

      expect(new AccumulatingLoader().optional('LOADER_VAR', 'user')).toBe('admin');
    });

    it.each([undefined, '   '])('returns the fallback and records nothing when the variable is %j', (value) => {
      if (value === undefined) {
        delete process.env.LOADER_VAR;
      } else {
        process.env.LOADER_VAR = value;
      }
      const loader = new AccumulatingLoader();

      expect(loader.optional('LOADER_VAR', 'user')).toBe('user');
      expect(loader.error()).toBeUndefined();
    });
  });

  describe('problems', () => {
    it('joins every recorded problem into one message', () => {
      delete process.env.LOADER_A;
      const loader = new AccumulatingLoader();

      loader.mandatory('LOADER_A');
      loader.report('LOADER_B', 'bad value');

      expect(loader.error()).toBe('LOADER_A is not set; LOADER_B: bad value');
    });

    it('throws one error naming every problem', () => {
      const loader = new AccumulatingLoader();
      loader.report('LOADER_A', 'first');
      loader.report('LOADER_B', 'second');

      expect(() => loader.throwIfInvalid()).toThrow('config validation failed: LOADER_A: first; LOADER_B: second');
    });

    it('does not throw when no problem was recorded', () => {
      expect(() => new AccumulatingLoader().throwIfInvalid()).not.toThrow();
    });
  });
});
