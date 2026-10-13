/**
 * A failure the code recognises and answers by its reason: not found, ownership mismatch, retries
 * exhausted, a request rejected on purpose. It needs no code fix, so the handler answers it without
 * flushing the buffered trace.
 *
 * Thrown by code below the handler; only the handler's catch inspects it. Anything reaching that catch
 * that is not an `ExpectedFailure` is unexpected and is flushed before it is answered. The message is
 * the reason that is shown to the caller.
 */
export class ExpectedFailure extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ExpectedFailure';
    Object.setPrototypeOf(this, ExpectedFailure.prototype);
  }
}
