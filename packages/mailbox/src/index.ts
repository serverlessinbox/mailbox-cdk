/** The public surface of the Serverless Inbox mailbox construct library. */

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
export type { SesReceivingMode } from './contracts/ses-receiving-mode';

// Hosted zone — looked up once by the app, passed to the constructs that need it
export { HostedZoneLookup } from './core/domains/hosted-zone-lookup';
export type { HostedZoneLookupProps } from './core/domains/hosted-zone-lookup';

// Stack-failure-detection — consent enum (referenced by MailboxProps.sendStackFailures)
export { SendStackFailuresMode } from './platform/ops/stack-failure-detection';

// Auth — types
export { DEFAULT_OIDC_PROVIDER_NAME } from './core/auth/types';
export {
  AUTH_POLICY_ADMIN_API,
  AUTH_POLICY_JMAP_API,
  OAUTH_CLIENT_ADMIN_UI,
  OAUTH_CLIENT_WEBMAIL_UI,
} from './contracts/auth-names';
export type { AuthPolicyName, OAuthClientName } from './contracts/auth-names';
export type {
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
} from './core/auth/types';

// Auth — JMAP scopes
export { Permission, JMAP_SCOPE_DESCRIPTIONS } from './core/auth/jmap-scopes';
export type { ScopeMap } from './core/auth/jmap-scopes';

// Admin API addons
export type { IAdminApiAddon, AdminApiAddonContext, IAdminApiAddonProvider, IJmapApiAddon, JmapApiAddonContext } from './core/apis/addons';
export type { IAuditEventsQueue } from './resources/queues/audit-events-queue';
export type { IIdentityProvisioner } from './resources/lambdas/identity-provisioner-lambda';
export type { IDataTable } from './resources/tables/data-tables';
export { StackUpdateAddonProvider } from './platform/update/stack-update-addon-provider';
export type { StackUpdateAddonProviderProps } from './platform/update/stack-update-addon-provider';
export { SupportMode } from './platform/support/support-addon';
export { SupportAddonProvider } from './platform/support/support-addon-provider';
export type { SupportAddonProviderProps } from './platform/support/support-addon-provider';

// Utils — tagging & correlation
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
} from './core/kms';

// Artifact resolution — the auto-updating resolver and its settings
export { AutoUpdater } from './platform/update/auto-updater';
export type { AutoUpdaterProps } from './platform/update/auto-updater';
export { Granularity } from './contracts/granularity';
export type { IUiContentDeployTarget, IUiContentUpdater } from './contracts/ui-content-updater';

