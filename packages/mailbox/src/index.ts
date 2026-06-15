/**
 * @mailbox/cdk - CDK Construct Library for Mailbox Infrastructure
 */

// Mailbox construct
export { Mailbox } from './mailbox';
export type { MailboxProps, MailboxOverrides, MailboxOAuthClients, MailboxCertificateOverrides, MailboxSubdomainOverrides, MailboxUrls, MailboxDataRefs, MailboxCertificates } from './mailbox';

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



// Utils — development mode
export {
  DEVELOPMENT_CONTEXT_KEYS,
  isDevelopmentMode,
} from './utils/development-mode';

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


