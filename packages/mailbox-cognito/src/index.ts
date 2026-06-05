/**
 * @serverlessinbox/mailbox-cognito - CDK Construct Library for Cognito-backed Mailbox Auth
 */

// Auth — user pool construct
export { MailboxUserPool } from './auth/mailbox-user-pool';
export type {
  MailboxUserPoolProps,
  MailboxUserPoolCognitoDomain,
  MailboxUserPoolCustomDomain,
  MailboxUserPoolDomain,
  MailboxUserPoolAuthorizationConfig,
  MailboxUserPoolCustomMessageConfig,
  ProvisionHeadlessClientConfig,
} from './auth/mailbox-user-pool';


// Auth — bootstrap user construct
export { BootstrapUser } from './auth/bootstrap-user';
export type { BootstrapUserProps } from './auth/bootstrap-user';

// Auth — custom message trigger construct
export { MailboxCognitoCustomMessage } from './auth/custom-message';
export type { MailboxCognitoCustomMessageProps } from './auth/custom-message';

// API — Cognito IdP users admin API addon
export { CognitoIdpUsersAdminApiAddon } from './api/cognito-idp-users-addon';
export type {
  CognitoIdpUsersAdminApiAddonProps,
  CognitoIdpUsersAuthorizationConfig,
  ICognitoIdpUsersPoolConfig,
} from './api/cognito-idp-users-addon';


// Artifacts
export { COGNITO_LAMBDAS_ARTIFACT_PACKAGE } from './artifacts';
