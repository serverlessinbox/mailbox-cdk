import type { Branded }    from './branded';
import { isBrandedString } from './branded';

/**
 * The identifiers of tenants, accounts and token issuers that several Lambdas pass between their units next to
 * other identifier kinds, each a string of its own kind so that one kind cannot be passed where another is
 * expected. Every kind has exactly one factory, and the cast to the brand sits in that factory and nowhere else.
 */

/** The tenant a request or a session token belongs to. */
export type TenantId = Branded<'TenantId'>;

/** A JMAP account of a tenant. */
export type AccountId = Branded<'AccountId'>;

/** The issuer (`iss`) of a token. */
export type Issuer = Branded<'Issuer'>;

export function toTenantId(raw: string): TenantId {
  return raw as TenantId;
}

export function toAccountId(raw: string): AccountId {
  return raw as AccountId;
}

export function toIssuer(raw: string): Issuer {
  return raw as Issuer;
}

export const isTenantId  = isBrandedString(toTenantId);
export const isAccountId = isBrandedString(toAccountId);
