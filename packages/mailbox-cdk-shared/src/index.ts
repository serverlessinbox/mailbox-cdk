// CDK context keys
export {
  ARTIFACTS_CONTEXT_KEY,
  ARTIFACT_VERSIONS_CONTEXT_KEY,
  DEPLOYER_TYPE_CONTEXT_KEY,
  DEVELOPMENT_CONTEXT_KEY,
  VENDOR_ACCOUNT_IDS_CONTEXT_KEY,
} from './context/context-keys';

// Artifact resolution: the resolver factory and the loaders of what a package ships
export { MailboxArtifactResolverFactory } from './artifacts/mailbox-artifact-resolver-factory';
export { loadEmbeddedRegistryRecord } from './artifacts/embedded-registry-record';
export { loadEmbeddedArtifactVersions } from './artifacts/embedded-artifact-versions';
export type { EmbeddedArtifactVersions } from './artifacts/embedded-artifact-versions';
export type { RegistryRecord } from '@serverlessinbox/artifact-registry/registry';

// CDK aspects & patterns
export { GateOnConditionAspect } from './gate-on-condition-aspect';

// Vendor account resolution
export { VENDOR_ACCOUNT_ID, resolveVendorAccountIds } from './context/vendor-account';
export type { VendorLink } from './context/vendor-account';

// Deployer type resolution
export { resolveDeployerType } from './context/deployer-type';
export type { ServerlessInboxDeployerType } from './context/deployer-type';

// Development mode
export { isDevelopmentMode, removalPolicyForRetainedResources, autoDeleteObjectsInDevelopment } from './context/development-mode';

// Lambda constructs & artifact tagging
export { TypeScriptLambda } from './resources/lambdas/ts-lambda';
export type { TypeScriptLambdaProps } from './resources/lambdas/ts-lambda';
export { GoLambda } from './resources/lambdas/go-lambda';
export type { GoLambdaProps } from './resources/lambdas/go-lambda';
export { applyArtifactTags } from './artifacts/apply-artifact-tags';
export type { AutoUpdateType } from './artifacts/apply-artifact-tags';

// Serverless Inbox tagging
export { ServerlessInboxTagKeys } from './runtime/handler-kit/tag-keys';
export {
  applyServerlessInboxBaseTags,
  applyServerlessInboxBaseTagsWithDeployerType,
  applyServerlessInboxComponentTag,
  applyServerlessInboxEdgeTags,
  serverlessInboxSubStackTags,
  rootStackResourceTagConditions,
  rootStackRequestTagConditions,
} from './tagging/serverless-inbox-tags';
export type {
  RootStack,
  RootStackConditions,
  ServerlessInboxComponent,
  ApplyServerlessInboxTagsOptions,
  ApplyServerlessInboxEdgeTagsOptions,
  ServerlessInboxSubStackTagOptions,
} from './tagging/serverless-inbox-tags';

// Static content deployer
export { StaticContentDeployer } from './resources/lambdas/content-deployer';
export type { StaticContentDeploymentProps, StaticContentInvalidationProps } from './resources/lambdas/content-deployer';
export { StaticContentSource } from './static-content-source';
export type { IStaticContentSource, StaticContentWriteOptions, StaticContentZipOptions } from './static-content-source';
export type { StaticContentSourceSpec } from './runtime/content-deployer/resource-properties';

// Stack-deployed event
export { StackDeployedEvent } from './resources/events/stack-deployed-event';

// Bucket auto-empty
export { BucketAutoEmpty } from './resources/lambdas/bucket-auto-empty';

// Public static assets bucket
export { PublicStaticAssetsBucket } from './resources/buckets/public-static-assets-bucket';
export type { IPublicStaticAssetsBucket } from './resources/buckets/public-static-assets-bucket';

// Named bucket
export { StackNamedBucket } from './resources/buckets/named-bucket';
export type { StackNamedBucketProps } from './resources/buckets/named-bucket';

// Stack name sanitizing
export { sanitizeStackName } from './naming/sanitize-name';

// Stack identity
export { PositionHash } from './naming/position-hash';
export { StackIdentity } from './naming/stack-identity';

// Shared group
export { getOrCreateSharedGroup } from './tagging/shared-group';

// Stack helpers
export { StackHelpers } from './stack-helpers';

// Stack name-base registry
export { setStackNameBase, getStackNameBase } from './naming/stack-name-base-registry';

// Pipeline taxonomy & shared per-pipeline log groups
export type { Pipeline } from './resources/lambdas/pipelines';
export { PipelineLogGroup } from './resources/lambdas/pipeline-log-groups';
export type { IPipelineLogGroup } from './resources/lambdas/pipeline-log-groups';

// Table & Queue constructs
export { BaseTable } from './resources/tables/base-table';
export { BaseQueue } from './resources/queues/base-queue';
export type { BaseQueueProps } from './resources/queues/base-queue';
export { StackNamedTable } from './resources/tables/named-table';
export type { StackNamedTableProps } from './resources/tables/named-table';

// Resource naming
export { makePhysicalName, slugifyLabel } from './naming/resource-names';
export type { PhysicalNameOptions } from './naming/resource-names';

// Resource group
export { ServerlessInboxResourceGroup } from './resources/groups/serverless-inbox-resource-group';
export type { ServerlessInboxResourceGroupProps } from './resources/groups/serverless-inbox-resource-group';

// Component description
export { ComponentDescription } from './tagging/component-description';

// Sub-stack deployer scaffolding: worker and starter Lambdas and the polling Step Functions workflow
export { DeployerInfra } from './deployer-infra';
export type { DeployerInfraProps } from './deployer-infra';
export { DeployerWorkerLambda } from './resources/lambdas/deployer-worker-lambda';
export type { DeployerWorkerLambdaProps } from './resources/lambdas/deployer-worker-lambda';
export { DeployedStack } from './resources/stacks/deployed-stack';
export type { IDeployedStack } from './resources/stacks/deployed-stack';
export { ArtifactObject } from './resources/artifacts/artifact-object';
export type { IArtifactObject } from './resources/artifacts/artifact-object';
export { DeployerStarterLambda } from './resources/lambdas/deployer-starter-lambda';
export type { DeployerStarterLambdaProps } from './resources/lambdas/deployer-starter-lambda';
export { PollingCfnDeployerWorkflow } from './resources/workflows/polling-cfn-deployer-workflow';
export type { PollingCfnDeployerWorkflowProps } from './resources/workflows/polling-cfn-deployer-workflow';
