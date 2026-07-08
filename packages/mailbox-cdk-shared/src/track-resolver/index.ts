/**
 * Exports for the TrackResolver feature (consumed by `TrackResolverProvider`).
 *
 * Relocated from `@serverlessinbox/artifact-registry` (stack-self-update, phase A cleanup) -- see
 * `handler.ts` and `build-properties.ts` for why.
 *
 * CRITICAL: all three exports come from SDK-FREE sources so this barrel never transitively
 * loads handler.ts (which imports @aws-sdk/client-s3). The handler is only reached by esbuild
 * at build time, never by the construct import graph at ts-node synth time.
 */

export { TRACK_RESOLVER_HANDLER_SOURCE } from './generated/track-resolver-handler-source';
export { TRACK_RESOLVER_VERSION_ATTR } from './attr';
export { buildTrackResolverProperties } from './build-properties';
export type { TrackResolverPropertiesInput } from './build-properties';
