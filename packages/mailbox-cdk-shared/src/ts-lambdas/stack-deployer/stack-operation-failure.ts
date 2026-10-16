import { CaughtError } from '../shared/caught-error';

/**
 * An AWS call failed while carrying out one step of a stack operation, or while starting its execution. The
 * message names the step and what the AWS call reported; it is the reason CloudFormation is answered with.
 * Any other unexpected failure is answered with the error named in the reason.
 */
export class StackOperationFailure extends Error {
  constructor(step: string, cause: unknown) {
    super(`${step}: ${new CaughtError(cause).describeWithMetadata()}`);
    this.name = 'StackOperationFailure';
    Object.setPrototypeOf(this, StackOperationFailure.prototype);
  }
}
