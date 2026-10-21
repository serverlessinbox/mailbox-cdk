import { isBrandedString, type Branded } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * The identifiers of the people and OAuth registrations that the identity provisioner contract and the audit
 * actor carry, each a string of its own kind so that one kind cannot be passed where another is expected. Every
 * kind has exactly one factory, and the cast to the brand sits in that factory and nowhere else.
 */

/** The email address of a user. */
export type EmailAddress = Branded<'EmailAddress'>;

/** A redirect URI that an OAuth client registered. */
export type RedirectUri = Branded<'RedirectUri'>;

/** One OAuth scope a token carries. */
export type Scope = Branded<'Scope'>;

/** The id of a mailbox principal. */
export type PrincipalId = Branded<'PrincipalId'>;

export function toEmailAddress(raw: string): EmailAddress {
  return raw as EmailAddress;
}

export function toRedirectUri(raw: string): RedirectUri {
  return raw as RedirectUri;
}

export function toScope(raw: string): Scope {
  return raw as Scope;
}

export function toPrincipalId(raw: string): PrincipalId {
  return raw as PrincipalId;
}

export const isRedirectUri = isBrandedString(toRedirectUri);
export const isPrincipalId = isBrandedString(toPrincipalId);
