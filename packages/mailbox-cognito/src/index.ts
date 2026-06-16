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
  ProvisionHeadlessClientConfig,
  BootstrapUserConfig,
} from './auth/mailbox-user-pool';



// API — Cognito IdP users admin API addon
export type {
  CognitoIdpUsersAuthorizationConfig,
  ICognitoIdpUsersPoolConfig,
} from './api/cognito-idp-users-addon';


// Artifacts
export { COGNITO_LAMBDAS_ARTIFACT_PACKAGE } from './artifacts';
