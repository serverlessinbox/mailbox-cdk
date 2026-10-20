// CDK context keys
export {
  ARTIFACTS_CONTEXT_KEY,
  ARTIFACT_VERSIONS_CONTEXT_KEY,
  DEPLOYER_TYPE_CONTEXT_KEY as DEPLOYER_CONTEXT_KEY,
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

// Deployer type resolution
export { resolveDeployerType } from './context/deployer-type';
export type { ServerlessInboxDeployerType } from './context/deployer-type';

// Development mode
export { isDevelopmentMode, removalPolicyForRetainedResources, autoDeleteObjectsInDevelopment } from './context/development-mode';

// Lambda constructs & artifact tagging
export { TypeScriptLambda } from './ts-lambda';
export type { TypeScriptLambdaProps } from './ts-lambda';
export { GoLambda } from './go-lambda';
export type { GoLambda2Props } from './go-lambda';
export { applyArtifactTags } from './artifacts/apply-artifact-tags';
export type { AutoUpdateType } from './artifacts/apply-artifact-tags';

// Serverless Inbox tagging
export {
  ServerlessInboxTagKeys,
  applyServerlessInboxBaseTags,
  applyServerlessInboxBaseTagsWithDeployerType,
  applyServerlessInboxComponentTag,
  applyServerlessInboxEdgeTags,
  serverlessInboxSubStackTags,
  rootStackResourceTagConditions,
  rootStackRequestTagConditions,
} from './serverless-inbox-tags';
export type {
  RootStack,
  RootStackConditions,
  ServerlessInboxComponent,
  ApplyServerlessInboxTagsOptions,
  ApplyServerlessInboxEdgeTagsOptions,
  ServerlessInboxSubStackTagOptions,
} from './serverless-inbox-tags';

// Static content deployer
export { StaticContentDeployer } from './content-deployer';
export type { StaticContentDeploymentProps, StaticContentInvalidationProps } from './content-deployer';
export { StaticContentSource } from './static-content-source';
export type { IStaticContentSource, StaticContentWriteOptions, StaticContentZipOptions } from './static-content-source';
export type { StaticContentSourceSpec } from './ts-lambdas/content-deployer/resource-properties';

// Bucket auto-empty
export { BucketAutoEmpty } from './bucket-auto-empty';

// Public static assets bucket
export { PublicStaticAssetsBucket } from './public-static-assets-bucket';

// Named bucket
export { StackNamedBucket } from './named-bucket';
export type { INamedBucket, StackNamedBucketProps } from './named-bucket';

// Stack name sanitizing
export { sanitizeStackName } from './naming/sanitize-name';

// Stack identity
export { PositionHash } from './naming/position-hash';
export { StackIdentity } from './naming/stack-identity';

// Shared group
export { getOrCreateSharedGroup } from './shared-group';

// Stack helpers
export { StackHelpers } from './stack-helpers';
export type { StackHelpersMailboxDataProps, StackHelpersMailboxData } from './stack-helpers';

// Stack name-base registry
export { setStackNameBase, getStackNameBase } from './naming/stack-name-base-registry';

// Pipeline taxonomy & shared per-pipeline log groups
export type { Pipeline } from './pipelines';
export { PipelineLogGroup } from './pipeline-log-groups';
export type { IPipelineLogGroup } from './pipeline-log-groups';

// Table & Queue constructs
export { BaseTable } from './base-table';
export { BaseQueue } from './base-queue';
export type { BaseQueueProps } from './base-queue';
export { StackNamedTable } from './named-table';
export type { INamedTable, StackNamedTableProps } from './named-table';

// Resource naming
export { makePhysicalName, slugifyLabel } from './naming/resource-names';
export type { PhysicalNameOptions } from './naming/resource-names';

// Resource group
export { addServerlessInboxResourceGroup } from './resource-group';
export type { ServerlessInboxResourceGroupProps } from './resource-group';

// DynamoDB least-privilege action sets & table grant helper
export { DynamoDbActions, grantTableActions } from './dynamodb-grants';

// SQS least-privilege action sets & queue grant helper
export { SqsActions, grantQueueActions } from './sqs-grants';

// S3 least-privilege object action sets & bucket grant helpers
export { S3Actions, grantObjectActions, grantListBucket } from './s3-grants';

// SSM Parameter Store least-privilege action set & parameter grant helper
export { SsmActions, grantParameterActions } from './ssm-grants';

// Sub-stack deployer scaffolding: worker and starter Lambdas and the polling Step Functions workflow
export { DeployerInfra, DeployerWorkerLambda, DeployerStarterLambda, PollingCfnDeployerWorkflow } from './deployer-infra';
export type {
  DeployerInfraProps,
  DeployerWorkerLambdaProps,
  DeployerStarterLambdaProps,
  PollingCfnDeployerWorkflowProps,
} from './deployer-infra';
