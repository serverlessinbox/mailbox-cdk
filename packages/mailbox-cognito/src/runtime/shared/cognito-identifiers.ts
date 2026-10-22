import { isBrandedString, type Branded } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * The identifiers of Cognito users, groups, pools and app clients, each a string of its own kind so that one kind
 * cannot be passed where another is expected. The brand exists in the type only. Every kind has exactly one
 * factory, and the cast to the brand sits in that factory and nowhere else.
 */

/** The id of a Cognito user pool. */
export type UserPoolId = Branded<'UserPoolId'>;

/** The name of a Cognito user, unique within its user pool. */
export type Username = Branded<'Username'>;

/** The name of a Cognito group of a user pool. */
export type GroupName = Branded<'GroupName'>;

/** The immutable `sub` Cognito assigns to a user; unlike the username, it is never reused for another person. */
export type UserSubject = Branded<'UserSubject'>;

/** The id of an app client of a Cognito user pool. */
export type ClientId = Branded<'ClientId'>;

export function toUserPoolId(raw: string): UserPoolId {
  return raw as UserPoolId;
}

export function toUsername(raw: string): Username {
  return raw as Username;
}

export function toGroupName(raw: string): GroupName {
  return raw as GroupName;
}

export function toUserSubject(raw: string): UserSubject {
  return raw as UserSubject;
}

export function toClientId(raw: string): ClientId {
  return raw as ClientId;
}

export const isGroupName = isBrandedString(toGroupName);
export const isClientId  = isBrandedString(toClientId);
