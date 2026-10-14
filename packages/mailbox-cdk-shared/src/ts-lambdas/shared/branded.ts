/**
 * A string of its own kind, so that one kind of identifier cannot be passed where another is expected. The
 * brand exists in the type only; a value is branded by one factory per kind, and the cast to the brand sits in
 * that factory and nowhere else.
 */
export type Branded<Kind extends string> = string & { readonly __brand: Kind };
