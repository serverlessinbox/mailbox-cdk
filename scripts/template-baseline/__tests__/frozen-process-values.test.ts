import { FrozenProcessValues } from '../frozen-process-values';

/**
 * Pins that the clock and the random generator are fixed for the duration of the work and
 * restored afterwards, also when the work throws: a freeze that leaked would silently change the
 * behaviour of everything that runs later in the same process.
 */
describe('FrozenProcessValues', () => {
  const frozen = new FrozenProcessValues(1_234_567, 0.25);

  it('fixes Date.now and Math.random while the work runs', () => {
    const observed = frozen.run(() => [Date.now(), Date.now(), Math.random(), Math.random()]);

    expect(observed).toEqual([1_234_567, 1_234_567, 0.25, 0.25]);
  });

  it('returns what the work returns', () => {
    expect(frozen.run(() => 'result')).toBe('result');
  });

  it('restores Date.now and Math.random after the work, including when it throws', () => {
    const originalNow = Date.now;
    const originalRandom = Math.random;

    expect(() => frozen.run(() => { throw new Error('boom'); })).toThrow('boom');

    expect(Date.now).toBe(originalNow);
    expect(Math.random).toBe(originalRandom);
  });
});
