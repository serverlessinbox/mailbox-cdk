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
  MailboxCertificates,
  SesReceivingMode,
} from './mailbox';

// Stack-failure-detection — consent enum (referenced by MailboxProps.sendStackFailures)
export { SendStackFailuresMode } from './features/stack-failure-detection';

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
  MailboxRole,
  MailboxAuthorizationConfig,
  IMailboxAuthorizationConfigProvider,
  IMailboxAuthProvider,
} from './auth/types';

// Auth — JMAP scopes
export { Permission, JMAP_SCOPE_DESCRIPTIONS } from './auth/jmap-scopes';

// Admin API addons
export type { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider, IJmapApiAddon, JmapApiAddonContext } from './api/addons';
export type { IAuditEventsQueue } from './features/audit-writing/audit-events-queue';
export type { IIdentityProvisioner } from './lambdas/identity-provisioner';
export type { IDataTable } from './data/data-tables';
export { StackUpdateAddonProvider } from './addons/stack-update/stack-update-addon';
export type { StackUpdateAddonProviderProps } from './addons/stack-update/stack-update-addon';
export { SupportAddonProvider, SupportMode } from './addons/support/support-addon';
export type { SupportAddonProviderProps } from './addons/support/support-addon';

// Utils — tagging & correlation (moved to shared package; re-exported from mailbox-cdk-shared)
export {
  ServerlessInboxTagKeys,
  applyServerlessInboxBaseTags,
  applyServerlessInboxComponentTag,
} from '@serverlessinbox/mailbox-cdk-shared';
export type {
  ServerlessInboxComponent,
  ApplyServerlessInboxTagsOptions,
} from '@serverlessinbox/mailbox-cdk-shared';

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

// Artifact resolution (stack-self-update subplan #3, Phase A, D2/D3 — jsii-exported types)
export type { IArtifactResolver, ResolvedArtifact } from './artifacts/i-artifact-resolver';
export { AutoUpdater } from './artifacts/resolvers';
export type { AutoUpdaterProps, Granularity } from './artifacts/resolvers';

