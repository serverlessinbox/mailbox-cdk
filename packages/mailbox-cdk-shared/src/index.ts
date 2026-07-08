// Artifact engine (D3 — replaces old ICdkArtifactResolver/CdkArtifactResolver)
export { PinnedResolver, CdkArtifactEngine } from './artifact-engine';
export type { IArtifactResolver, ICdkArtifactEngine, ResolvedArtifact, VersionMap, VersionMapEntry } from './artifact-engine';

// Track resolver pure-data exports (for AutoUpdater)
export { TRACK_RESOLVER_HANDLER_SOURCE } from './track-resolver/generated/track-resolver-handler-source';
export { TRACK_RESOLVER_VERSION_ATTR } from './track-resolver/attr';
export { buildTrackResolverProperties } from './track-resolver/build-properties';
export type { TrackResolverPropertiesInput } from './track-resolver/build-properties';
