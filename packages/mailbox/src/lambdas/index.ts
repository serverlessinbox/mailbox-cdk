/**
 * Lambdas folder - centralized Go Lambda definitions
 * 
 * Each lambda is defined as a class extending GoLambda or GoLambda2
 * with a Props interface containing all required inputs (tables, queues, buckets, etc).
 * 
 * This provides:
 * - Clear input parameter mapping for each lambda
 * - Type-safe configuration
 * - Automatic permission granting
 * - Centralized memory/timeout settings
 */

export { EmailProcessorLambda } from './email-processor';
export type { EmailProcessorLambdaProps } from './email-processor';

export { ApiHandlerLambda } from './jmap-api';
export type { ApiHandlerLambdaProps } from './jmap-api';

export { AuthorizerLambda } from './authorizer';
export type { AuthorizerLambdaProps } from './authorizer';

export { AdminApiLambda } from './admin-api';
export type { AdminApiLambdaProps } from './admin-api';

export { IdpTokenExchangeLambda } from './idp-token-exchange';
export type { IdpTokenExchangeLambdaProps } from './idp-token-exchange';

export { WebSocketConnectLambda } from './websocket-connect';
export type { WebSocketConnectLambdaProps } from './websocket-connect';

export { WebSocketDisconnectLambda } from './websocket-disconnect';
export type { WebSocketDisconnectLambdaProps } from './websocket-disconnect';

export { WebSocketMessageLambda } from './websocket-message';
export type { WebSocketMessageLambdaProps } from './websocket-message';

export { WebSocketBroadcastLambda } from './websocket-broadcast';
export type { WebSocketBroadcastLambdaProps } from './websocket-broadcast';

export { SESEventProcessorLambda } from './ses-event-processor';
export type { SESEventProcessorLambdaProps } from './ses-event-processor';

export { EmailSenderLambda } from './email-sender';
export type { EmailSenderLambdaProps } from './email-sender';

export { TantivyIndexerLambda } from './tantivy-indexer';
export type { TantivyIndexerLambdaProps } from './tantivy-indexer';

export { AuthKeyStoreUpdaterLambda } from './auth-key-store-updater';
export type { AuthKeyStoreUpdaterLambdaProps } from './auth-key-store-updater';

export { AuditWriterLambda } from './audit-writer';
export type { AuditWriterLambdaProps } from './audit-writer';

export { BootstrapLambda } from './bootstrap';
export type { BootstrapLambdaProps, SesReceivingMode } from './bootstrap';

export { IdentityProvisionerLambda } from './identity-provisioner';
export type { IdentityProvisionerLambdaProps } from './identity-provisioner';

export { LicenseRefresherLambda } from './license-refresher';
export type { LicenseRefresherLambdaProps } from './license-refresher';

export { ResourceSweeperStarterLambda } from './resource-sweeper-starter';
export type { ResourceSweeperStarterLambdaProps } from './resource-sweeper-starter';

export { ResourceSweeperWorkerLambda } from './resource-sweeper-worker';
export type { ResourceSweeperWorkerLambdaProps } from './resource-sweeper-worker';

export { ArtifactUpdaterLambda } from './artifact-updater';
export type { ArtifactUpdaterLambdaProps } from './artifact-updater';

export { StackDeployerStarterLambda } from './stack-deployer-starter';
export type { StackDeployerStarterLambdaProps } from './stack-deployer-starter';

export { StackDeployerWorkerLambda } from './stack-deployer-worker';
export type { StackDeployerWorkerLambdaProps } from './stack-deployer-worker';

export { StackUpdateApiLambda } from './stack-update-api';
export type { StackUpdateApiLambdaProps } from './stack-update-api';

export { SupportApiLambda } from './support-api';
export type { SupportApiLambdaProps } from './support-api';
