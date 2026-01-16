/**
 * @mailbox/cdk - CDK Construct Library for Mailbox Infrastructure
 */

export * from './mailbox';
export * from './auth';
export * from './domains';
export * from './edge';
export * from './utils/artifact-resolver';
export { createArtifactResolverFromContext } from './utils/artifact-context';
export * from './auth/jmap-scopes';
export * from './email-processing';
export { AdminUi, AdminUiProps } from './ui/admin-ui';
export { WebmailUi, WebmailUiProps } from './ui/webmail-ui';
export * from './lambdas';
