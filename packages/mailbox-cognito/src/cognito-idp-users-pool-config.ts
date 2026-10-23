import type { IFunction } from 'aws-cdk-lib/aws-lambda';

/**
 * The Cognito groups that mark admins and regular users for the users API. Pass the names of the groups you
 * created in your user pool for these two roles; names are compared case-insensitively.
 */
export interface CognitoIdpUsersAuthorizationConfig {
  /**
   * The names of the Cognito groups whose members are admins. A user created through the API into one of these
   * groups is flagged as an admin when its mailbox is provisioned, so an empty list creates no admins.
   */
  readonly adminGroups: string[];

  /**
   * The names of the Cognito groups whose members are regular users. The API reads them to decide which
   * callers carry the user role.
   */
  readonly userGroups: string[];
}

/**
 * What the users API needs from a Cognito user pool: which pool it is, the permission to administer the users
 * in it, and optionally which groups mark admins and users.
 */
export interface ICognitoIdpUsersPoolConfig {
  /** The id of the user pool whose users the API lists, creates, enables, disables and deletes. */
  readonly userPoolId: string;

  /**
   * Grants the users API Lambda the permissions to administer users in this pool. It is called once, with the
   * Lambda; without the grant the Lambda's calls to Cognito are denied.
   */
  grantAdminAccess(grantee: IFunction): void;

  /**
   * Returns the groups that mark admins and users. Leave it out when your pool defines no such groups: the API
   * is then configured with no group names.
   */
  authorizationConfig?(): CognitoIdpUsersAuthorizationConfig;
}
