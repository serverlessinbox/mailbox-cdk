import * as t                  from 'typanion';

import { isBrandedString }     from '../branded';
import { parseLogLevelStrict } from '../log-level';

/**
 * Pins the validator every identifier kind builds on: it takes a string only, runs the kind's factory on it, and
 * lets the factory's own refusal through. The factory here is a real one that refuses some strings.
 */
describe('isBrandedString', () => {
  const toLevel = jest.fn(parseLogLevelStrict);
  const isLevel = isBrandedString(toLevel);

  beforeEach(() => {
    toLevel.mockClear();
  });

  it('accepts a string after running the factory on it', () => {
    expect(isLevel('DEBUG')).toBe(true);
    expect(toLevel).toHaveBeenCalledWith('DEBUG');
  });

  it('rejects a value that is not a string without running the factory', () => {
    expect(isLevel(42)).toBe(false);
    expect(toLevel).not.toHaveBeenCalled();
  });

  it('lets the error of a factory that refuses the string pass through', () => {
    expect(() => t.as('verbose', isLevel)).toThrow("Invalid log level: 'verbose'");
  });
});
