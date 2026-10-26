/** The principal a request comes from, as the authorizer looked it up. */
export type PrincipalId = string & { readonly brand: 'PrincipalId' };

/** The only way to make a `PrincipalId`; an empty value is not a principal. */
export function toPrincipalId(value: string): PrincipalId {
  if (value.length === 0) {
    throw new Error('principal id is empty');
  }
  return value as PrincipalId; // cast: the brand has no runtime form
}
