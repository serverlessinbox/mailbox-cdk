import * as t from 'typanion';
import {
  isStackName,
  toExecutionArn,
  toStackName,
  toStateMachineArn,
  type ExecutionArn,
  type StackName,
} from '../deployer-identifiers';

/**
 * Pins the two things the identifier kinds exist for: one kind cannot be passed where another is expected,
 * and the ARN kinds refuse a string that is not that kind of ARN. The swap is checked by the compiler, so the
 * `@ts-expect-error` below turns into a failure if the kinds ever become interchangeable.
 */
describe('deployer identifiers', () => {
  const STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:deployer';
  const EXECUTION_ARN = 'arn:aws:states:us-east-1:123456789012:execution:deployer:request-123';

  function describeExecution(arn: ExecutionArn): string {
    return arn;
  }

  function describeStack(name: StackName): string {
    return name;
  }

  it('does not accept a stack name where an execution ARN is expected, nor the other way round', () => {
    // @ts-expect-error a StackName is not an ExecutionArn
    describeExecution(toStackName('mail-data'));
    // @ts-expect-error an ExecutionArn is not a StackName
    describeStack(toExecutionArn(EXECUTION_ARN));
  });

  it('does not accept a plain string where a kind is expected', () => {
    // @ts-expect-error a plain string is not a StackName
    describeStack('mail-data');
  });

  describe('toStateMachineArn', () => {
    it('keeps the ARN it is given', () => {
      expect(toStateMachineArn(STATE_MACHINE_ARN)).toBe(STATE_MACHINE_ARN);
    });

    it.each([
      ['not-an-arn', 'Invalid ARN "not-an-arn": expected arn:partition:service:region:account:resource'],
      [EXECUTION_ARN, `Invalid ARN "${EXECUTION_ARN}": expected a Step Functions stateMachine`],
      ['arn:aws:sqs:us-east-1:123456789012:stateMachine:deployer', 'Invalid ARN "arn:aws:sqs:us-east-1:123456789012:stateMachine:deployer": expected a Step Functions stateMachine'],
    ])('refuses %s', (raw, problem) => {
      expect(() => toStateMachineArn(raw)).toThrow(problem);
    });
  });

  describe('toExecutionArn', () => {
    it('keeps the ARN it is given', () => {
      expect(toExecutionArn(EXECUTION_ARN)).toBe(EXECUTION_ARN);
    });

    it('refuses the ARN of a state machine', () => {
      expect(() => toExecutionArn(STATE_MACHINE_ARN)).toThrow(`Invalid ARN "${STATE_MACHINE_ARN}": expected a Step Functions execution`);
    });
  });

  describe('a validator', () => {
    it('accepts a string and reports a value that is not one', () => {
      expect(isStackName('mail-data')).toBe(true);
      expect(t.as(42, isStackName, { errors: true }).errors).toEqual(['.: Expected a string (got 42)']);
    });
  });
});
