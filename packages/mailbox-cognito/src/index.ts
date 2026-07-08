/**
 * @serverlessinbox/mailbox-cognito - CDK Construct Library for Cognito-backed Mailbox Auth
 */

// Auth — user pool construct
export { MailboxUserPool } from './auth/mailbox-user-pool';
export type {
  MailboxUserPoolProps,
  MailboxUserPoolDomainConfig,
  MailboxUserPoolCognitoDomain,
  MailboxUserPoolCustomDomain,
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
/** Package name for mailbox-cognito artifacts. */
export const COGNITO_ARTIFACT_PACKAGE = 'mailbox-cognito' as const;

// Cognito data stack
export * from './cognito';
