import { awsError }              from '../../__tests__/stack-deployer-helpers';
import { StackOperationFailure } from '../stack-operation-failure';

/**
 * Pins the reason a failed stack step is answered to CloudFormation with: the step and what the AWS call
 * reported. The class itself is the signal the failure answerer keys on, so it must stay an Error that
 * `instanceof` recognises.
 */
describe('StackOperationFailure', () => {
  it('names the step and what the AWS call reported in its message', () => {
    const failure = new StackOperationFailure('Failed to start the stack', awsError('AccessDenied', 'not allowed'));

    expect(failure.message).toBe('Failed to start the stack: AccessDenied: not allowed');
  });

  it('is recognised as a StackOperationFailure and as an Error', () => {
    const failure = new StackOperationFailure('Failed to start the stack', awsError('AccessDenied', 'not allowed'));

    expect(failure).toBeInstanceOf(StackOperationFailure);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.name).toBe('StackOperationFailure');
  });
});
