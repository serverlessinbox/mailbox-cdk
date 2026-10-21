import * as t from 'typanion';

/**
 * A string of its own kind, so that one kind of identifier cannot be passed where another is expected. The
 * brand exists in the type only; a value is branded by one factory per kind, and the cast to the brand sits in
 * that factory and nowhere else.
 */
export type Branded<Kind extends string> = string & { readonly brand: Kind };

type AnyBrand = { readonly brand: string };

type PlainValue<Value> = Value extends AnyBrand ? string : Value;

/** The same shape with every branded string as the plain string it is on the wire, for code that writes the payload without these brands. */
export type Unbranded<Shape> = { [Field in keyof Shape]: PlainValue<Shape[Field]> };

// A payload value gets its brand from the kind's factory, like every other value; the factory of these kinds accepts any string.
export function isBrandedString<Brand extends string>(toBrand: (raw: string) => Brand): t.StrictValidator<unknown, Brand> {
  return t.makeValidator<unknown, Brand>({
    test: (value, state): value is Brand => {
      if (!t.isString()(value, state)) {
        return false;
      }
      toBrand(value);
      return true;
    },
  });
}
