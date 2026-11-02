/**
 * Pins how long a personal access token verdict is held and what is held at all. A usable verdict held past five
 * minutes, or past its row's expiry, would keep a revoked or expired token working; an unusable verdict not held
 * would read the table for every junk secret; a failed read that was held would turn one outage into a minute of
 * denials; a map that was not bounded would let attacker-chosen hashes grow the container without limit.
 */

import { toTenantId }      from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { PatVerdict } from '../auth-tokens';
import { PatVerdictCache } from '../pat-verdict-cache';

const MINUTE = 60 * 1000;

const EXPIRES_IN_A_DAY = 24 * 60 * MINUTE;

const USABLE: PatVerdict   = { usable: true, tenantId: toTenantId('tenant-1'), tokenId: 'pat_1', expiresAt: EXPIRES_IN_A_DAY };
const UNUSABLE: PatVerdict = { usable: false, reason: 'not-found' };

describe('PatVerdictCache', () => {
  let now: number;
  let cache: PatVerdictCache;

  beforeEach(() => {
    now   = 0;
    cache = new PatVerdictCache(() => now);
  });

  it('holds a usable verdict for five minutes, then reads it again', async () => {
    const read = jest.fn(async (): Promise<PatVerdict> => USABLE);

    await cache.verdictFor('hash-1', read);
    now = 5 * MINUTE - 1;
    await cache.verdictFor('hash-1', read);
    expect(read).toHaveBeenCalledTimes(1);

    now = 5 * MINUTE;
    await cache.verdictFor('hash-1', read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never holds a usable verdict past the expiry of its row', async () => {
    const expiringSoon: PatVerdict = { usable: true, tenantId: toTenantId('tenant-1'), tokenId: 'pat_1', expiresAt: MINUTE };

    const read = jest.fn(async (): Promise<PatVerdict> => expiringSoon);

    await cache.verdictFor('hash-1', read);
    now = MINUTE;
    await cache.verdictFor('hash-1', read);

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('holds an unusable verdict for one minute, so a junk secret is not read on every request', async () => {
    const read = jest.fn(async (): Promise<PatVerdict> => UNUSABLE);

    await cache.verdictFor('hash-1', read);
    now = MINUTE - 1;
    await cache.verdictFor('hash-1', read);
    expect(read).toHaveBeenCalledTimes(1);

    now = MINUTE;
    await cache.verdictFor('hash-1', read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('holds at most 1000 verdicts, dropping the oldest to admit a new one', async () => {
    const read = jest.fn(async (): Promise<PatVerdict> => UNUSABLE);
    for (let index = 0; index < 1000; index++) {
      await cache.verdictFor(`hash-${index}`, read);
    }
    await cache.verdictFor('hash-1000', read);
    expect(read).toHaveBeenCalledTimes(1001);

    await cache.verdictFor('hash-999', read);
    expect(read).toHaveBeenCalledTimes(1001);

    await cache.verdictFor('hash-0', read);
    expect(read).toHaveBeenCalledTimes(1002);
  });

  it('shares one read between requests for the same hash that arrive while it is in flight', async () => {
    let release: () => void = () => undefined;

    const read = jest.fn(() => new Promise<PatVerdict>((resolve) => {
      release = () => resolve(USABLE);
    }));

    const first  = cache.verdictFor('hash-1', read);
    const second = cache.verdictFor('hash-1', read);
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([USABLE, USABLE]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('does not hold a failed read, so the next request reads again', async () => {
    const read = jest.fn<Promise<PatVerdict>, []>()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(USABLE);

    await expect(cache.verdictFor('hash-1', read)).rejects.toThrow('read failed');
    await expect(cache.verdictFor('hash-1', read)).resolves.toEqual(USABLE);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
