export type Validator<T> = (req: unknown) => T;

export function createValidator<T>(parse: (req: unknown) => T, check?: (value: T) => void): Validator<T> {
  return (req: unknown): T => {
    const value = parse(req);
    check?.(value);
    return value;
  };
}
