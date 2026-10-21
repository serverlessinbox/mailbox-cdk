/// <reference types="jest" />

/**
 * Pins the scheduled trigger: it runs the update cycle, and the caller of a scheduled run or self-invoke sees
 * every failure, so a failed cycle, or a cycle that cannot be built because the configuration failed to load,
 * is thrown and `answerFailure` throws what it is given. The update cycle is faked because it reads and writes AWS.
 */

import { ScheduledTrigger }                                 from '../scheduled-trigger';
import { UpdateCycle }                                      from '../update-cycle';

import { BAD_CONFIG_ERROR, badConfigCycle, newUpdateCycle } from './updater-helpers';

jest.mock('../update-cycle');

describe('ScheduledTrigger', () => {
  const cycleRuns = () => jest.mocked(UpdateCycle.prototype.run);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs the update cycle once', async () => {
    await new ScheduledTrigger(newUpdateCycle).handle();

    expect(cycleRuns()).toHaveBeenCalledTimes(1);
  });

  it('throws what the update cycle throws', async () => {
    cycleRuns().mockRejectedValueOnce(new Error('tagging unavailable'));

    await expect(new ScheduledTrigger(newUpdateCycle).handle()).rejects.toThrow('tagging unavailable');
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
