/**
 * A failure the code recognises and answers by its reason: not found, ownership mismatch, retries
 * exhausted, a request rejected on purpose. It needs no code fix, so it is answered without flushing
 * the buffered trace. The message is the reason shown to the caller.
 */
export class ExpectedFailure extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ExpectedFailure';
    Object.setPrototypeOf(this, ExpectedFailure.prototype);
  }
}
