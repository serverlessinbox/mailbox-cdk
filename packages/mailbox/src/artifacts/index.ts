// Artifact resolution (stack-self-update subplan #3, Phase A, D1/D3)
// Replaced in Phase A with new architecture; see mailbox/src/index.ts and /mailbox-cdk-shared/src/artifact-engine.ts
// Old exports removed; consumers must use new AutoUpdater/Granularity from resolvers/

export { AutoUpdater } from './resolvers';
export type { AutoUpdaterProps, Granularity } from './resolvers';
