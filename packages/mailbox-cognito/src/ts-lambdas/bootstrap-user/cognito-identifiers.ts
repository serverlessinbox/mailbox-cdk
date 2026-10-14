import type { Branded } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * The identifiers the bootstrap user Lambda passes between its units, each a string of its own kind so that one
 * kind cannot be passed where another is expected. The brand exists in the type only. Every kind has exactly one
 * factory, and the cast to the brand sits in that factory and nowhere else.
 */

/** The id of the Cognito user pool the bootstrap user belongs to. */
export type UserPoolId = Branded<'UserPoolId'>;

/** The name of a Cognito user, unique within its user pool. */
export type Username = Branded<'Username'>;

/** The name of a Cognito group of a user pool. */
export type GroupName = Branded<'GroupName'>;

export function toUserPoolId(raw: string): UserPoolId {
  return raw as UserPoolId;
}

export function toUsername(raw: string): Username {
  return raw as Username;
}

export function toGroupName(raw: string): GroupName {
  return raw as GroupName;
}
