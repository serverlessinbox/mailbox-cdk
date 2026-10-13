import * as t from 'typanion';

// An SDK error carries its request metadata beside the standard fields; only the fields read are listed.
const isSdkErrorMetadata = t.isPartial({
  $metadata: t.isOptional(t.isPartial({
    httpStatusCode: t.isOptional(t.isNumber()),
    requestId: t.isOptional(t.isString()),
  })),
});

/**
 * A caught value read as an AWS SDK failure: the service exception name, its message and the request metadata
 * the SDK reported. A caught value that is not an `Error` has no name, message or metadata. Callers branch on
 * the name with `is`, and put the failure in a log field or a result reason with `describe` or
 * `describeWithMetadata`.
 */
export class CaughtError {
  public readonly name: string | undefined;
  public readonly message: string | undefined;
  private readonly thrown: unknown;
  private readonly httpStatusCode: number | undefined;
  private readonly requestId: string | undefined;

  constructor(thrown: unknown) {
    this.thrown = thrown;
    this.name = thrown instanceof Error ? thrown.name : undefined;
    this.message = thrown instanceof Error ? thrown.message : undefined;
    this.httpStatusCode = this.metadataOf(thrown)?.httpStatusCode;
    this.requestId = this.metadataOf(thrown)?.requestId;
  }

  /** True when the caught value is an `Error` named `errorName`; a value that is not an `Error` is never any name. */
  public is(errorName: string): boolean {
    return this.name === errorName;
  }

  /** True when the caught value is an `Error` whose message contains `text`. */
  public messageIncludes(text: string): boolean {
    return this.message?.includes(text) ?? false;
  }

  /** The caught error as one `name: message` line, for a result's reason; a non-`Error` value reads `undefined: undefined`. */
  public describe(): string {
    return `${this.name}: ${this.message}`;
  }

  /**
   * The caught error as one `Name: message` line followed by the HTTP status and request id the SDK reported,
   * when it reported any. A value without a name is named `Error` and one without a message reads as its
   * string form, so any thrown value yields a usable reason.
   */
  public describeWithMetadata(): string {
    const name = this.name ? this.name : 'Error';
    const message = this.message ? this.message : String(this.thrown);
    const metadata = [
      this.httpStatusCode ? `http=${this.httpStatusCode}` : undefined,
      this.requestId ? `requestId=${this.requestId}` : undefined,
    ].filter(Boolean).join(' ');
    return metadata ? `${name}: ${message} (${metadata})` : `${name}: ${message}`;
  }

  private metadataOf(thrown: unknown): t.InferType<typeof isSdkErrorMetadata>['$metadata'] {
    return thrown instanceof Error && isSdkErrorMetadata(thrown) ? thrown.$metadata : undefined;
  }
}
