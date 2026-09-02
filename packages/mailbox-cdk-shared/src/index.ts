// Artifact engine (D3 — replaces old ICdkArtifactResolver/CdkArtifactResolver)
export { PinnedResolver, CdkArtifactEngine } from './artifact-engine';
export type { IArtifactResolver, ICdkArtifactEngine, ResolvedArtifact, VersionMap, VersionMapEntry } from './artifact-engine';

// CDK aspects & patterns
export { GateOnConditionAspect } from './gate-on-condition-aspect';

// Lambda constructs & artifact tagging (used by mailbox, mailbox-cognito, and other sub-stack packages)
export { TypeScriptLambda } from './ts-lambda';
export type { TypeScriptLambdaProps } from './ts-lambda';
export { applyArtifactTags } from './apply-artifact-tags';
export type { AutoUpdateType } from './apply-artifact-tags';

// Static content deployer (used for UI bundles, well-known docs, etc.)
export { StaticContentDeployer, StaticContentSource } from './content-deployer';
export type { StaticContentDeploymentProps, StaticContentInvalidationProps, IStaticContentSource, StaticContentSourceSpec, StaticContentWriteOptions, StaticContentZipOptions } from './content-deployer';

// Bucket auto-empty (removes all objects & versions on stack deletion, enabling RemovalPolicy.DESTROY)
export { BucketAutoEmpty } from './bucket-auto-empty';

// Public static assets bucket (singleton shared bucket for discovery docs, config, etc.)
export { PublicStaticAssetsBucket } from './public-static-assets-bucket';

// Named bucket utility (creates S3 buckets with stack-derived names)
export { StackNamedBucket } from './named-bucket';
export type { INamedBucket, StackNamedBucketProps } from './named-bucket';

// Sanitize stack name utility (for AWS resource naming)
export { sanitizeStackName } from './sanitize-name';

// Shared group utility (for singleton constructs at stack root)
export { getOrCreateSharedGroup } from './shared-group';

// Pipeline taxonomy & shared per-pipeline log groups
export type { Pipeline } from './pipelines';
export { getOrCreatePipelineLogGroup } from './pipeline-log-groups';
