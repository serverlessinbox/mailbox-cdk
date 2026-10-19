import type { NonDeterministicProperty } from './template-diff';

/** Properties that differ between synths of identical code; `diff` lists them apart instead of failing on them. */
export const KNOWN_NON_DETERMINISTIC_PROPERTIES: readonly NonDeterministicProperty[] = [];
