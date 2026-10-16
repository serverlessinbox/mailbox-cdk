/**
 * The answer to a CloudFormation request could not be delivered, after the attempts the responder makes. It
 * is never answered again: a second answer for the request would not be delivered either, and it ends the
 * invocation so that the failure is loud.
 */
export class AnswerDeliveryFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnswerDeliveryFailure';
    Object.setPrototypeOf(this, AnswerDeliveryFailure.prototype);
  }
}
