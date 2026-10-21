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

export { LicenseRefresherLambda } from './license-refresher';
export type { LicenseRefresherLambdaProps } from './license-refresher';

export { ResourceSweeperStarterLambda } from './resource-sweeper-starter';
export type { ResourceSweeperStarterLambdaProps } from './resource-sweeper-starter';

export { ResourceSweeperWorkerLambda } from './resource-sweeper-worker';
export type { ResourceSweeperWorkerLambdaProps } from './resource-sweeper-worker';

export { ArtifactUpdaterLambda } from './artifact-updater';
export type { ArtifactUpdaterLambdaProps } from './artifact-updater';

export { StackUpdateApiLambda } from './stack-update-api';
export type { StackUpdateApiLambdaProps } from './stack-update-api';

export { SupportApiLambda } from './support-api';
export type { SupportApiLambdaProps } from './support-api';

export { StackFailureDetectorLambda } from './stack-failure-detector';
export type { StackFailureDetectorLambdaProps } from './stack-failure-detector';
