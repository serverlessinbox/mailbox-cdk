const SECRET_KEY = /password|secret|token|credential|responseurl/i;
const REDACTED   = '[redacted]';

/**
 * Input that only our own components produce (a custom-resource request from our template, a state machine
 * payload) failed validation. That is a defect, not an outcome the code handles by design, so it is a plain
 * error and not an `ExpectedFailure`: the handler flushes the buffered trace and the message shows what arrived.
 * The message names the failing fields and carries the offending input with every secret-looking value (a
 * key containing password, secret, token, credential or ResponseURL) redacted, at any depth.
 */
export class InvalidOwnInput extends Error {
  public readonly input: unknown;

  constructor(subject: string, failingFields: readonly string[], input: unknown) {
    const redacted = InvalidOwnInput.redact(input);
    super(`${subject}: ${failingFields.join('; ')}. Input: ${JSON.stringify(redacted)}`);
    this.name  = 'InvalidOwnInput';
    this.input = redacted;
    Object.setPrototypeOf(this, InvalidOwnInput.prototype);
  }

  private static redact(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((element: unknown) => InvalidOwnInput.redact(element));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]): [string, unknown] => [key, SECRET_KEY.test(key) ? REDACTED : InvalidOwnInput.redact(entry)]),
      );
    }
    return value;
  }
}
