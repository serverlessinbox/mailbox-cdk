/**
 * @mailbox/cdk - CDK Construct Library for Mailbox Infrastructure
 */

// Mailbox construct
export { Mailbox } from './mailbox';
export type { MailboxProps, MailboxOAuthClients } from './mailbox';

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

// Artifacts — resolver
export { ArtifactResolver } from './artifacts/artifact-resolver';
export type {
  ReleaseTarget,
  ChannelTarget,
  TrackTarget,
  PublishTarget,
  IArtifactResolver,
  ArtifactResolverConfig,
} from './artifacts/artifact-resolver';

// Artifacts — context helper
export { createArtifactResolverFromContext } from './artifacts/artifact-context';

// Artifacts — prefix utilities
export type { ArtifactReference } from './artifacts/artifact-prefix';
export {
  getArtifactPrefix,
  getEdgeArtifactPrefix,
  getArtifactUrl,
  getEdgeArtifactUrl,
} from './artifacts/artifact-prefix';

// Utils — development mode
export {
  DEVELOPMENT_CONTEXT_KEYS,
  isDevelopmentMode,
  removalPolicyForRetainedResources,
  autoDeleteObjectsInDevelopment,
} from './utils/development-mode';

// Utils — KMS
export type {
  MailboxKmsMode,
  MailboxKmsResource,
  MailboxKmsPerResourceConfig,
  MailboxKmsConfig,
} from './utils/kms';
export {
  mailboxKmsMode,
  mailboxKmsDisabled,
  mailboxKmsExcluded,
  resolveEmailBucketKey,
  resolveDynamoTablesKey,
  resolveQueuesKey,
} from './utils/kms';


