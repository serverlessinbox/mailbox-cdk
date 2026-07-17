/**
 * @mailbox/cdk - CDK Construct Library for Mailbox Infrastructure
 */

// Mailbox construct
export { Mailbox } from './mailbox';
export type {
  MailboxProps,
  MailboxOverrides,
  MailboxOAuthClients,
  MailboxCertificateOverrides,
  MailboxSubdomainOverrides,
  MailboxUrls,
  MailboxDataRefs,
  MailboxCertificates,
  SesReceivingMode,
} from './mailbox';

// Auth — types
export {
  DEFAULT_OIDC_PROVIDER_NAME,
  AUTH_POLICY_ADMIN_API,
  AUTH_POLICY_JMAP_API,
  OAUTH_CLIENT_ADMIN_UI,
  OAUTH_CLIENT_JMAP_UI,
} from './auth/types';
export type {
  AuthPolicyName,
  OAuthClientName,
  AuthMethod,
  OidcProviderConfig,
  AuthPolicyConfig,
  AuthPoliciesConfig,
  MailboxAuthPolicies,
  OAuthClientCredentials,
  OAuthFlow,
  OAuthAuthorizationCodeClientConfig,
  OAuthClientCredentialsClientConfig,
  OAuthClientConfig,
  OAuthClientsConfig,
  GenerateClientParams,
  AuthClientConfig,
  ProvisionAdminUiClientParams,
  ProvisionJmapUiClientParams,
  IMailboxAuthProviderBase,
  IAdminUiConfigProvider,
  MailboxRole,
  MailboxAuthorizationConfig,
  IMailboxAuthorizationConfigProvider,
  IMailboxAuthProvider,
} from './auth/types';

// Auth — JMAP scopes
export { Permission, JMAP_SCOPE_DESCRIPTIONS } from './auth/jmap-scopes';

// Admin API addons
export type { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider } from './api/addons';
export { StackUpdateAddonProvider } from './addons/stack-update-addon';
export type { StackUpdateAddonProviderProps } from './addons/stack-update-addon';

// Utils — development mode
export {
  DEVELOPMENT_CONTEXT_KEYS,
  isDevelopmentMode,
} from './utils/development-mode';

// Utils — tagging & correlation (used by sibling sub-stack packages, e.g. mailbox-cognito)
export {
  ServerlessInboxTagKeys,
  applyServerlessInboxBaseTags,
  applyServerlessInboxComponentTag,
  applyServerlessInboxEdgeTags,
  serverlessInboxSubStackTags,
} from './utils/serverless-inbox-tags';
export type {
  ServerlessInboxComponent,
  ServerlessInboxDeployer,
  ApplyServerlessInboxTagsOptions,
  ApplyServerlessInboxEdgeTagsOptions,
  ServerlessInboxSubStackTagOptions,
} from './utils/serverless-inbox-tags';

// Utils — resource-descriptions Aspect (Name tags + native descriptions for sub-stacks)
export { MailboxResourceDescriptions } from './utils/resource-descriptions';
export type { MailboxResourceDescriptionsOptions } from './utils/resource-descriptions';

// Utils — KMS
export type {
  MailboxKmsMode,
  MailboxKmsResource,
  MailboxKmsPerResourceConfig,
  MailboxKmsConfig,
} from './utils/kms';

// Data stack
export { MailboxDataStack } from './data';
export type { MailboxDataStackProps } from './data';
export { MailboxDataStackRef } from './data';
export type { MailboxDataStackRefProps } from './data';

// Artifact resolution (stack-self-update subplan #3, Phase A, D2/D3 — jsii-exported types)
export type { IArtifactResolver, ResolvedArtifact } from './artifacts/i-artifact-resolver';
export { AutoUpdater } from './artifacts/resolvers';
export type { AutoUpdaterProps, Granularity } from './artifacts/resolvers';

