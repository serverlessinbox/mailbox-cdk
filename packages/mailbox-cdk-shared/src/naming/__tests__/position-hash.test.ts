import { App, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PositionHash } from '../position-hash';

/**
 * Pins what `PositionHash` is made of: the path relative to the stack, nothing else. Names built from
 * it must change when a construct moves to another parent and must not change with the stack's id,
 * which is why the stack path is stripped before hashing.
 */
function newStack(stackId: string): Stack {
  return new Stack(new App(), stackId, { env: { account: '111122223333', region: 'eu-west-1' } });
}

describe('PositionHash.of', () => {
  it('is 8 lowercase hex characters', () => {
    const stack = newStack('TestStack');

    expect(PositionHash.of(new Construct(stack, 'worker'))).toMatch(/^[0-9a-f]{8}$/);
  });

  it('differs for the same id under two different parents', () => {
    const stack = newStack('TestStack');
    const first = new Construct(stack, 'group-one');
    const second = new Construct(stack, 'group-two');

    expect(PositionHash.of(new Construct(first, 'worker'))).not.toBe(PositionHash.of(new Construct(second, 'worker')));
  });

  it('is equal for the same relative path in two stacks with different ids', () => {
    const inFirstStack = new Construct(new Construct(newStack('FirstStack'), 'group'), 'worker');
    const inSecondStack = new Construct(new Construct(newStack('SecondStack'), 'group'), 'worker');

    expect(PositionHash.of(inFirstStack)).toBe(PositionHash.of(inSecondStack));
  });

  it('hashes the stack itself as an empty relative path', () => {
    expect(PositionHash.of(newStack('FirstStack'))).toBe(PositionHash.of(newStack('SecondStack')));
  });
});

describe('PositionHash.ofChild', () => {
  it('equals the hash of a construct later created as that child', () => {
    const parent = new Construct(newStack('TestStack'), 'group');

    const expected = PositionHash.ofChild(parent, 'worker');

    expect(PositionHash.of(new Construct(parent, 'worker'))).toBe(expected);
  });

  it('equals the hash of a child created directly under the stack', () => {
    const stack = newStack('TestStack');

    const expected = PositionHash.ofChild(stack, 'worker');

    expect(PositionHash.of(new Construct(stack, 'worker'))).toBe(expected);
  });
});
