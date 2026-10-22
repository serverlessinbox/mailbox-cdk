import * as t from 'typanion';

/**
 * A smoke-test check: throws to fail the probe, returns to pass it.
 */
export type Check = () => Promise<void> | void;

/**
 * The only payload of a probe. The schema rejects any other key, so a real event that happens to carry the flag
 * beside its own fields is real traffic.
 */
export const isSmokeTestProbeShape = t.isObject({ serverlessInboxSmokeTest: t.isLiteral(true) });

/**
 * Smoke test probe payload.
 */
export type SmokeTestProbe = Partial<t.InferType<typeof isSmokeTestProbeShape>>;

/**
 * Smoke test response payload.
 */
export interface SmokeTestResponse {
  serverlessInboxSmokeTestOk: boolean;
}
