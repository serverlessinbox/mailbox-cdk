/**
 * The fields of a caught value that callers branch on: the AWS service
 * exception name and its message. A caught value that is not an `Error` has neither.
 */
export class CaughtError {
  public readonly name: string | undefined;
  public readonly message: string | undefined;

  constructor(thrown: unknown) {
    this.name = thrown instanceof Error ? thrown.name : undefined;
    this.message = thrown instanceof Error ? thrown.message : undefined;
  }

  /** True when the caught value is an `Error` named `errorName`; a value that is not an `Error` is never any name. */
  public is(errorName: string): boolean {
    return this.name === errorName;
  }

  /** The caught error as one `name: message` line, for a result's reason; a non-`Error` value reads `undefined: undefined`. */
  public describe(): string {
    return `${this.name}: ${this.message}`;
  }
}
