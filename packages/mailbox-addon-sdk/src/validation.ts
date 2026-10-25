/** Turns an unvalidated request body into a typed request, or throws. */
export type Validator<T> = (req: unknown) => T;

/** Builds a validator that parses the body and then runs the optional extra check on the parsed value. */
export function createValidator<T>(parse: (req: unknown) => T, check?: (value: T) => void): Validator<T> {
  return (req: unknown): T => {
    const value = parse(req);
    check?.(value);
    return value;
  };
}
