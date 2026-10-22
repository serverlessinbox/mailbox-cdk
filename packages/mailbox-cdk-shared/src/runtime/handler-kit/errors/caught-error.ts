import * as t from 'typanion';

// An SDK error carries its request metadata beside the standard fields; only the fields read are listed.
const isSdkErrorMetadata = t.isPartial({
  $metadata: t.isOptional(t.isPartial({
    httpStatusCode: t.isOptional(t.isNumber()),
    requestId:      t.isOptional(t.isString()),
  })),
});

/**
 * A caught value read as an AWS SDK failure: the service exception name, its message and the request metadata
 * the SDK reported. A caught value that is not an `Error` has no name, message or metadata. A caller that needs
 * one answer from a thrown value calls the static (`CaughtError.is`, `readableMessage`, `describeWithMetadata`);
 * a caller that reads several parts of the same failure keeps an instance and branches on its name with `is`,
 * and puts it in a log field or a result reason with `describe` or `describeWithMetadata`.
 */
export class CaughtError {
  public readonly name: string | undefined;
  public readonly message: string | undefined;
  private readonly thrown: unknown;

  constructor(thrown: unknown) {
    this.thrown  = thrown;
    this.name    = CaughtError.nameOf(thrown);
    this.message = CaughtError.messageOf(thrown);
  }

  /** True when `thrown` is an `Error` named `errorName`; a value that is not an `Error` is never any name. */
  public static is(thrown: unknown, errorName: string): boolean {
    return CaughtError.nameOf(thrown) === errorName;
  }

  /** The message of a thrown `Error`, or the string form of a thrown value that is not an `Error`; an empty message stays empty. */
  public static readableMessage(thrown: unknown): string {
    return CaughtError.messageOf(thrown) ?? String(thrown);
  }

  /**
   * A thrown value as one `Name: message` line followed by the HTTP status and request id the SDK reported,
   * when it reported any. A value without a name is named `Error` and one without a message reads as its
   * string form, so any thrown value yields a usable reason.
   */
  public static describeWithMetadata(thrown: unknown): string {
    const name     = CaughtError.nameOf(thrown) ? CaughtError.nameOf(thrown) : 'Error';
    const message  = CaughtError.messageOf(thrown) ? CaughtError.messageOf(thrown) : String(thrown);
    const sdk      = CaughtError.metadataOf(thrown);
    const metadata = [
      sdk?.httpStatusCode ? `http=${sdk.httpStatusCode}` : undefined,
      sdk?.requestId ? `requestId=${sdk.requestId}` : undefined,
    ].filter(Boolean).join(' ');
    return metadata ? `${name}: ${message} (${metadata})` : `${name}: ${message}`;
  }

  private static nameOf(thrown: unknown): string | undefined {
    return thrown instanceof Error ? thrown.name : undefined;
  }

  private static messageOf(thrown: unknown): string | undefined {
    return thrown instanceof Error ? thrown.message : undefined;
  }

  private static metadataOf(thrown: unknown): t.InferType<typeof isSdkErrorMetadata>['$metadata'] {
    return thrown instanceof Error && isSdkErrorMetadata(thrown) ? thrown.$metadata : undefined;
  }

  /** True when the caught value is an `Error` named `errorName`; a value that is not an `Error` is never any name. */
  public is(errorName: string): boolean {
    return this.name === errorName;
  }

  /** True when the caught value is an `Error` whose message contains `text`. */
  public messageIncludes(text: string): boolean {
    return this.message?.includes(text) ?? false;
  }

  /** The message of the caught `Error`, or the string form of a caught value that is not an `Error`; an empty message stays empty. */
  public readableMessage(): string {
    return CaughtError.readableMessage(this.thrown);
  }

  /** The caught error as one `name: message` line, for a result's reason; a non-`Error` value reads `undefined: undefined`. */
  public describe(): string {
    return `${this.name}: ${this.message}`;
  }

  /** The caught error as one `Name: message` line followed by the HTTP status and request id the SDK reported, when it reported any. */
  public describeWithMetadata(): string {
    return CaughtError.describeWithMetadata(this.thrown);
  }
}
