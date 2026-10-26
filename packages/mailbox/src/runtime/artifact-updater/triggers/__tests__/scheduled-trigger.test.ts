/// <reference types="jest" />

/**
 * Pins the scheduled trigger's own part: the caller of a scheduled run or self-invoke sees every failure, so a
 * cycle that cannot be built because the configuration failed to load is thrown without running anything, and
 * `answerFailure` throws what it is given. That a built cycle is run is the pass-through of the trigger and is
 * not pinned here. The update cycle is faked because it reads and writes AWS.
 */

import { BAD_CONFIG_ERROR, badConfigCycle, newUpdateCycle } from '../../__tests__/updater-helpers';
import { UpdateCycle }                                      from '../../update-cycle';
import { ScheduledTrigger }                                 from '../scheduled-trigger';

jest.mock('../../update-cycle');

describe('ScheduledTrigger', () => {
  const cycleRuns = () => jest.mocked(UpdateCycle.prototype.run);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws the configuration error, and runs nothing, when the cycle cannot be built', async () => {
    await expect(new ScheduledTrigger(badConfigCycle).handle()).rejects.toThrow(BAD_CONFIG_ERROR);

    expect(cycleRuns()).not.toHaveBeenCalled();
  });

  it('answers a failure by throwing it unchanged', () => {
    const failure = new Error('boom');

    expect(() => new ScheduledTrigger(newUpdateCycle).answerFailure(failure)).toThrow(failure);
  });
});
