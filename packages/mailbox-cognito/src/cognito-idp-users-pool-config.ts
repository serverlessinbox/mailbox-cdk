import type { MailboxAuthorizationConfig }  from '@serverlessinbox/mailbox';
import type { IUserPool }                   from 'aws-cdk-lib/aws-cognito';
import type { IFunction }                   from 'aws-cdk-lib/aws-lambda';

/**
 * What the users API needs from a Cognito user pool: which pool it is, the permission to administer the users
 * in it, and optionally which groups mark admins and users.
 */
export interface ICognitoIdpUsersPoolConfig {
  /** The Cognito user pool whose users the API lists, creates, enables, disables and deletes. */
  readonly userPool: IUserPool;

  /**
   * Grants the users API Lambda the permissions to administer users in this pool. It is called once, with the
   * Lambda; without the grant the Lambda's calls to Cognito are denied.
   */
  grantAdminAccess(grantee: IFunction): void;

  /**
   * Returns the groups that mark admins and users. Leave it out when your pool defines no such groups: the API
   * is then configured with no group names.
   */
  authorizationConfig?(): MailboxAuthorizationConfig;
}
