// Pins the lane arithmetic the import rule relies on: a name of 68 characters keeps `from` on column 80,
// a line may end at column 79 but not at 80, and the closing brace counts as part of the last name.
// An off-by-one in any of these moves the boundary pairs below.
import { ImportPacker, type ImportParts } from '../import-packer';

const LANE_COLUMN = 80;

const packer = new ImportPacker(LANE_COLUMN);

const identifierOf = (length: number): string => 'a'.repeat(length);

const partsOf = (names: string[], head = 'import {', indentColumn = 0): ImportParts => ({ indentColumn, head, names });

describe('ImportPacker.isWide', () => {
  it('a single name of 68 characters keeps from on the lane', () => {
    expect(packer.isWide(partsOf([identifierOf(68)]))).toBe(false);
  });

  it('a single name of 69 characters pushes from past the lane', () => {
    expect(packer.isWide(partsOf([identifierOf(69)]))).toBe(true);
  });
});

describe('ImportPacker.pack', () => {
  it('the head line takes its first name when that name ends at column 79', () => {
    expect(packer.pack(partsOf([identifierOf(69), 'b']))).toEqual([`import { ${identifierOf(69)},`, '  b }']);
  });

  it('a first name that would end at column 80 leaves the head line alone', () => {
    expect(packer.pack(partsOf([identifierOf(70), 'b']))).toEqual(['import {', `  ${identifierOf(70)}, b }`]);
  });

  it('a name that ends at column 79 stays on its line', () => {
    expect(packer.pack(partsOf(['a', identifierOf(66), 'z']))).toEqual([`import { a, ${identifierOf(66)},`, '  z }']);
  });

  it('a name that would end at column 80 starts a new line', () => {
    expect(packer.pack(partsOf(['a', identifierOf(67), 'z']))).toEqual(['import { a,', `  ${identifierOf(67)}, z }`]);
  });

  it('a last name that ends its line at column 79 keeps the closing brace on that line', () => {
    expect(packer.pack(partsOf(['a', identifierOf(65)]))).toEqual([`import { a, ${identifierOf(65)} }`]);
  });

  it('a last name that would end at column 80 moves to its own line with the closing brace', () => {
    expect(packer.pack(partsOf(['a', identifierOf(66)]))).toEqual(['import { a,', `  ${identifierOf(66)} }`]);
  });

  it('the last name carries no trailing comma', () => {
    expect(packer.pack(partsOf([identifierOf(69), identifierOf(69)]))).toEqual([`import { ${identifierOf(69)},`, `  ${identifierOf(69)} }`]);
  });

  it('a type head stays on the first line', () => {
    expect(packer.pack(partsOf(['a'], 'import type {'))).toEqual(['import type { a }']);
  });

  it('a default head stays on the first line', () => {
    expect(packer.pack(partsOf(['a'], 'import Def, {'))).toEqual(['import Def, { a }']);
  });

  it('continuation lines of an indented import sit two columns past the statement', () => {
    expect(packer.pack(partsOf([identifierOf(69), 'b'], 'import {', 2))).toEqual(['  import {', `    ${identifierOf(69)}, b }`]);
  });

  it('a name too long to share a continuation line makes the lines fail the lane check', () => {
    expect(packer.fitsLane(packer.pack(partsOf(['a', identifierOf(76)])))).toBe(false);
  });

  it('a short import packs onto one line that fits the lane', () => {
    expect(packer.fitsLane(packer.pack(partsOf(['a', 'b'])))).toBe(true);
  });
});
