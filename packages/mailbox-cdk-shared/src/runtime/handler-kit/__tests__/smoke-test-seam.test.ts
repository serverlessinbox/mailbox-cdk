/**
 * Pins how the smoke-test seam tells a probe from real traffic and how it answers one. Real traffic mistaken for a
 * probe would be answered with a health marker instead of being processed, and a check that fails without turning
 * the answer false would let the updater keep code that does not fit its configuration.
 */

import { SmokeTestSeam } from '../smoke-test-seam';

describe('SmokeTestSeam', () => {
  describe('isProbe', () => {
    const seam = new SmokeTestSeam([]);

    it('recognises the probe object', () => {
      expect(seam.isProbe({ serverlessInboxSmokeTest: true })).toBe(true);
    });

    it('recognises JSON text of the probe', () => {
      expect(seam.isProbe(JSON.stringify({ serverlessInboxSmokeTest: true }))).toBe(true);
    });

    it('rejects an event that carries the probe flag beside other keys', () => {
      expect(seam.isProbe({ serverlessInboxSmokeTest: true, RequestType: 'Create' })).toBe(false);
    });

    it('rejects a probe flag that is not true', () => {
      expect(seam.isProbe({ serverlessInboxSmokeTest: false })).toBe(false);
    });

    it('rejects text that is not JSON', () => {
      expect(seam.isProbe('not valid json')).toBe(false);
    });

    it.each([null, undefined])('rejects %p', (event) => {
      expect(seam.isProbe(event)).toBe(false);
    });
  });

  describe('answer', () => {
    it('is healthy when every check passes', async () => {
      const check1 = jest.fn(async () => undefined);
      const check2 = jest.fn(() => undefined);

      const result = await new SmokeTestSeam([check1, check2]).answer();

      expect(check1).toHaveBeenCalledTimes(1);
      expect(check2).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ serverlessInboxSmokeTestOk: true });
    });

    it('is healthy when there are no checks', async () => {
      expect(await new SmokeTestSeam([]).answer()).toEqual({ serverlessInboxSmokeTestOk: true });
    });

    it('is unhealthy at the first check that throws, and the remaining checks do not run', async () => {
      const failingCheck   = jest.fn(async () => {
        throw new Error('Config validation failed');
      });
      const unreachedCheck = jest.fn(async () => undefined);

      const result = await new SmokeTestSeam([failingCheck, unreachedCheck]).answer();

      expect(unreachedCheck).not.toHaveBeenCalled();
      expect(result).toEqual({ serverlessInboxSmokeTestOk: false });
    });

    it('is unhealthy when a synchronous check throws', async () => {
      const syncFailingCheck = jest.fn(() => {
        throw new Error('Config validation failed');
      });

      const result = await new SmokeTestSeam([syncFailingCheck]).answer();

      expect(result).toEqual({ serverlessInboxSmokeTestOk: false });
    });
  });
});
