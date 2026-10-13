// CDK context keys (centralized — see context-keys.ts for the shipped-key rename hazard)
export {
  ARTIFACTS_CONTEXT_KEY,
  ARTIFACT_VERSIONS_CONTEXT_KEY,
  DEPLOYER_TYPE_CONTEXT_KEY as DEPLOYER_CONTEXT_KEY,
  DEVELOPMENT_CONTEXT_KEY,
  VENDOR_ACCOUNT_IDS_CONTEXT_KEY,
} from './context-keys';

// Artifact resolution: the resolver factory and the loaders of what a package ships
export { MailboxArtifactResolverFactory } from './mailbox-artifact-resolver-factory';
export { loadEmbeddedRegistryRecord } from './embedded-registry-record';
export { loadEmbeddedArtifactVersions } from './embedded-artifact-versions';
export type { EmbeddedArtifactVersions } from './embedded-artifact-versions';
export type { RegistryRecord } from '@serverlessinbox/artifact-registry/registry';

// CDK aspects & patterns
export { GateOnConditionAspect } from './gate-on-condition-aspect';

// Vendor account resolution (cross-cutting; consumed by mailbox's composition roots)
export { VENDOR_ACCOUNT_ID, resolveVendorAccountIds } from './vendor-account';

// Deployer type resolution (cross-cutting; consumed by mailbox's composition roots)
export { resolveDeployerType } from './deployer-type';
export type { ServerlessInboxDeployerType } from './deployer-type';

// Development mode (cross-cutting; consumed by mailbox and mailbox-cognito)
export { isDevelopmentMode, removalPolicyForRetainedResources, autoDeleteObjectsInDevelopment } from './development-mode';

// Lambda constructs & artifact tagging (used by mailbox, mailbox-cognito, and other sub-stack packages)
export { TypeScriptLambda } from './ts-lambda';
export type { TypeScriptLambdaProps } from './ts-lambda';
export { GoLambda } from './go-lambda';
export type { GoLambda2Props } from './go-lambda';
export { applyArtifactTags } from './apply-artifact-tags';
export type { AutoUpdateType } from './apply-artifact-tags';

// Serverless Inbox tagging (moved from mailbox to shared to allow shared-group.ts to use it)
export {
  ServerlessInboxTagKeys,
  applyServerlessInboxBaseTags,
  applyServerlessInboxBaseTagsWithDeployerType,
  applyServerlessInboxComponentTag,
  applyServerlessInboxEdgeTags,
  serverlessInboxSubStackTags,
  rootStackResourceTagCondition,
  rootStackRequestTagCondition,
} from './serverless-inbox-tags';
export type {
  ServerlessInboxComponent,
  ApplyServerlessInboxTagsOptions,
  ApplyServerlessInboxEdgeTagsOptions,
  ServerlessInboxSubStackTagOptions,
} from './serverless-inbox-tags';

// Static content deployer (used for UI bundles, well-known docs, etc.)
export { StaticContentDeployer } from './content-deployer';
export type { StaticContentDeploymentProps, StaticContentInvalidationProps } from './content-deployer';
export { StaticContentSource } from './static-content-source';
export type { IStaticContentSource, StaticContentWriteOptions, StaticContentZipOptions } from './static-content-source';
export type { StaticContentSourceSpec } from './ts-lambdas/content-deployer/resource-properties';

// Bucket auto-empty (removes all objects & versions on stack deletion, enabling RemovalPolicy.DESTROY)
export { BucketAutoEmpty } from './bucket-auto-empty';

// Public static assets bucket (singleton shared bucket for discovery docs, config, etc.)
export { PublicStaticAssetsBucket } from './public-static-assets-bucket';

// Named bucket utility (creates S3 buckets with stack-derived names)
export { StackNamedBucket } from './named-bucket';
export type { INamedBucket, StackNamedBucketProps } from './named-bucket';

// Sanitize stack name utility (for AWS resource naming)
export { sanitizeStackName } from './naming/sanitize-name';

// Shared group utility (for singleton constructs at stack root)
export { getOrCreateSharedGroup } from './shared-group';

// Stack helpers — domain name / S3-safe stack name derivation singleton (shared by mailbox and
// mailbox-cognito, which each attach their own custom resource to the one Lambda)
export { StackHelpers } from './stack-helpers';
export type { StackHelpersMailboxDataProps, StackHelpersMailboxData } from './stack-helpers';

// Stack name-base registry (for coordinating S3-safe names across constructs)
export { setStackNameBase, getStackNameBase } from './naming/stack-name-base-registry';

// Pipeline taxonomy & shared per-pipeline log groups
export type { Pipeline } from './pipelines';
export { PipelineLogGroup } from './pipeline-log-groups';
export type { IPipelineLogGroup } from './pipeline-log-groups';

// Table & Queue constructs (used by mailbox and mailbox-cognito)
export { BaseTable } from './base-table';
export { BaseQueue } from './base-queue';
export type { BaseQueueProps } from './base-queue';
export { StackNamedTable } from './named-table';
export type { INamedTable, StackNamedTableProps } from './named-table';

// Resource naming utilities
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

// Sub-stack deployer scaffolding (worker/starter Lambdas + polling Step Functions workflow),
// shared by mailbox's data/edge deployers and mailbox-cognito's data deployer.
export { DeployerInfra, DeployerWorkerLambda, DeployerStarterLambda, PollingCfnDeployerWorkflow } from './deployer-infra';
export type {
  DeployerInfraProps,
  DeployerWorkerLambdaProps,
  DeployerStarterLambdaProps,
  PollingCfnDeployerWorkflowProps,
} from './deployer-infra';
