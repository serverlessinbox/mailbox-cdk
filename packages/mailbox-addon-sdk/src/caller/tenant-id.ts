/** The tenant a request belongs to, as the authorizer decided it. */
export type TenantId = string & { readonly brand: 'TenantId' };

/** The only way to make a `TenantId`; an empty value is not a tenant. */
export function toTenantId(value: string): TenantId {
  if (value.length === 0) {
    throw new Error('tenant id is empty');
  }
  return value as TenantId; // cast: the brand has no runtime form
}
