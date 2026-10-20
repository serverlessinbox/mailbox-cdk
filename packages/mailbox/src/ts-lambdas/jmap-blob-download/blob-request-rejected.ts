import { ExpectedFailure } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

/**
 * A request the authorizer answers with an error status instead of forwarding it: a denial, a malformed
 * download URL or a distribution without configuration. The message is the answer's status description.
 */
export class BlobRequestRejected extends ExpectedFailure {
  public readonly status: number;

  constructor(status: number, answer: string) {
    super(answer);
    this.name   = 'BlobRequestRejected';
    this.status = status;
    Object.setPrototypeOf(this, BlobRequestRejected.prototype);
  }
}
