/**
 * @mailbox/cdk - CDK Construct Library for Mailbox Infrastructure
 */

// Mailbox construct
export { Mailbox } from './mailbox';
export type {
  MailboxProps,
  MailboxOverrides,
  MailboxCertificateOverrides,
  MailboxSubdomainOverrides,
} from './mailbox-props';
export type {
  MailboxOAuthClients,
  MailboxUrls,
  MailboxCertificates,
} from './mailbox-outputs';
export type { SesReceivingMode } from './core/email/ses-receiving-mode';

// Stack-failure-detection — consent enum (referenced by MailboxProps.sendStackFailures)
export { SendStackFailuresMode } from './platform/ops/stack-failure-detection';

// Auth — types
export {
  DEFAULT_OIDC_PROVIDER_NAME,
  AUTH_POLICY_ADMIN_API,
  AUTH_POLICY_JMAP_API,
  OAUTH_CLIENT_ADMIN_UI,
  OAUTH_CLIENT_WEBMAIL_UI,
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
  ProvisionAdminApiClientParams,
  ProvisionJmapApiClientParams,
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
export { StackUpdateAddonProvider } from './platform/update/stack-update-addon';
export type { StackUpdateAddonProviderProps } from './platform/update/stack-update-addon';
export { SupportMode } from './platform/support/support-addon';
export { SupportAddonProvider } from './platform/support/support-addon-provider';
export type { SupportAddonProviderProps } from './platform/support/support-addon-provider';

// Utils — tagging & correlation (re-exported from mailbox-cdk-shared)
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

// Artifact resolution — the auto-updating resolver and its settings
export { AutoUpdater } from './platform/update/auto-updater';
export type { AutoUpdaterProps, Granularity } from './platform/update/auto-updater';

