import type { Branded } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * The identifiers the JMAP blob download function passes between the verifiers that read a token and the authorizer that
 * compares them, each a string of its own kind so that one kind cannot be passed where another is expected.
 * Every kind has exactly one factory, and the cast to the brand sits in that factory and nowhere else.
 */

/** The tenant a session token was issued for. */
export type TenantId = Branded<'TenantId'>;

/** A JMAP account a session token lets its bearer read blobs of. */
export type AccountId = Branded<'AccountId'>;

/** The issuer of a token, without trailing slashes. */
export type Issuer = Branded<'Issuer'>;

/** The audience of a token; empty when the token names none. */
export type Audience = Branded<'Audience'>;

export function toTenantId(raw: string): TenantId {
  return raw as TenantId;
}

export function toAccountId(raw: string): AccountId {
  return raw as AccountId;
}

export function toIssuer(raw: string): Issuer {
  return raw as Issuer;
}

export function toAudience(raw: string): Audience {
  return raw as Audience;
}
