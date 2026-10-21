import * as t from 'typanion';

/**
 * A switch of a stack operation. CloudFormation sends a boolean property as the text `'true'` or `'false'`, so
 * a switch is a boolean or one of those two texts; any other value is not a switch and is rejected, never read
 * as on or off.
 */
export const isStackFlag = t.isOneOf([t.isBoolean(), t.isEnum(['true', 'false'] as const)]);

/** A switch of a stack operation, in the form it arrived in. */
export type StackFlag = t.InferType<typeof isStackFlag>;

/** Whether the switch is on: `true` or `'true'`. A switch that is absent is off. */
export function isSwitchedOn(flag: StackFlag | undefined): boolean {
  return flag === true || flag === 'true';
}
