import { isStackFlag, isSwitchedOn, type StackFlag } from '../stack-flag';

/**
 * Pins what counts as a switch of a stack operation and which switches are on. The same rule reads
 * preserveOnDelete and terminationProtection: a value that is not a switch must be rejected, because reading
 * it as on or off would either keep a stack that was to be deleted or delete one that was to be kept.
 */
describe('stack flag', () => {
  describe('isStackFlag', () => {
    it.each([true, false, 'true', 'false'])('accepts %j', (value) => {
      expect(isStackFlag(value)).toBe(true);
    });

    it.each(['sometimes', '', '1', 'TRUE', 1, null])('does not accept %j', (value) => {
      expect(isStackFlag(value)).toBe(false);
    });
  });

  describe('isSwitchedOn', () => {
    it.each<[StackFlag | undefined, boolean]>([
      [true, true],
      ['true', true],
      [false, false],
      ['false', false],
      [undefined, false],
    ])('reads %j as %s', (flag, expected) => {
      expect(isSwitchedOn(flag)).toBe(expected);
    });
  });
});
