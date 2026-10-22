/**
 * @serverlessinbox/mailbox-cognito - CDK Construct Library for Cognito-backed Mailbox Auth
 */

// Auth — user pool construct
export { MailboxUserPool } from './user-pool/mailbox-user-pool';
export { DynamicClientRegistrationMode } from './user-pool/dynamic-client-registration-mode';
export { MfaMode } from './user-pool/mfa-mode';
export { UserPoolAudience } from './user-pool/user-pool-audience';
export type {
  MailboxUserPoolAdminUiConfig,
  MailboxUserPoolIdpUiConfig,
} from './user-pool/mailbox-user-pool-admin-ui-config';
export type {
  MailboxUserPoolProps,
  MailboxUserPoolDomainConfig,
  MailboxUserPoolCognitoDomain,
  MailboxUserPoolCognitoAutoDomain,
  MailboxUserPoolCustomDomain,
  MailboxUserPoolAuthorizationConfig,
  ProvisionHeadlessClientConfig,
  BootstrapUserConfig,
  IBootstrapUserHandle,
} from './user-pool/mailbox-user-pool';



// API — Cognito IdP users admin API addon
export type {
  CognitoIdpUsersAuthorizationConfig,
  ICognitoIdpUsersPoolConfig,
} from './cognito-idp-users-pool-config';


// Artifacts
export { COGNITO_ARTIFACT_PACKAGE } from './cognito-artifact-package';
