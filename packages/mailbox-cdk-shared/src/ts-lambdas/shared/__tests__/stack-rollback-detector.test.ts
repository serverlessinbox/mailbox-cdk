/**
 * Pins the two parent-stack questions a custom resource asks before it answers: is the stack rolling back, and is it
 * being deleted. A status that cannot be read must answer false, because a wrong true makes a handler answer SUCCESS
 * during a normal update or skip work it must do, and a wrong false during a rollback strands the stack.
 */

import { CloudFormationClient, DescribeStacksCommand }         from '@aws-sdk/client-cloudformation';
import { mockClient }                                          from 'aws-sdk-client-mock';

import { toStackId }                                           from '../custom-resource-identifiers';
import { LoggerBuffer }                                        from '../logger-buffer';
import { isParentStackBeingDeleted, isParentStackRollingBack } from '../stack-rollback-detector';

const STACK_ID = toStackId('arn:aws:cloudformation:us-east-1:123456789012:stack/mail/guid');

describe('parent stack detectors', () => {
  const cfnMock   = mockClient(CloudFormationClient);
  const cfnClient = new CloudFormationClient({});

  beforeEach(() => {
    cfnMock.reset();
  });

  describe.each([
    { name: 'isParentStackRollingBack', detect: isParentStackRollingBack, matchingStatus: 'UPDATE_ROLLBACK_IN_PROGRESS', otherStatus: 'UPDATE_IN_PROGRESS' },
    { name: 'isParentStackBeingDeleted', detect: isParentStackBeingDeleted, matchingStatus: 'DELETE_IN_PROGRESS', otherStatus: 'UPDATE_COMPLETE' },
  ])('$name', ({ detect, matchingStatus, otherStatus }) => {
    it(`returns true for ${matchingStatus} and asks for the stack by its id`, async () => {
      cfnMock.on(DescribeStacksCommand).resolves({ Stacks: [{ StackName: 'mail', CreationTime: new Date(0), StackStatus: matchingStatus as never }] });

      await expect(detect(STACK_ID, cfnClient)).resolves.toBe(true);
      expect(cfnMock.commandCalls(DescribeStacksCommand)[0].args[0].input).toEqual({ StackName: STACK_ID });
    });

    it(`returns false for ${otherStatus}`, async () => {
      cfnMock.on(DescribeStacksCommand).resolves({ Stacks: [{ StackName: 'mail', CreationTime: new Date(0), StackStatus: otherStatus as never }] });

      await expect(detect(STACK_ID, cfnClient)).resolves.toBe(false);
    });

    it('returns false when no stack is returned', async () => {
      cfnMock.on(DescribeStacksCommand).resolves({ Stacks: [] });

      await expect(detect(STACK_ID, cfnClient)).resolves.toBe(false);
    });

    it('returns false without a logger when the lookup fails', async () => {
      cfnMock.on(DescribeStacksCommand).rejects(new Error('Stack not found'));

      await expect(detect(STACK_ID, cfnClient)).resolves.toBe(false);
    });

    it('returns false and records the failure as a buffered warn on the given logger when the lookup fails', async () => {
      cfnMock.on(DescribeStacksCommand).rejects(new Error('AccessDenied'));
      const logger         = new LoggerBuffer();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await expect(detect(STACK_ID, cfnClient, logger)).resolves.toBe(false);
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      logger.flush();
      expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to check parent stack status: AccessDenied');
      consoleWarnSpy.mockRestore();
    });
  });

  it('records the text of a failure that is not an Error', async () => {
    cfnMock.on(DescribeStacksCommand).callsFake(() => Promise.reject('plain text'));
    const logger         = new LoggerBuffer(undefined, 'warn');
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    await isParentStackRollingBack(STACK_ID, cfnClient, logger);

    expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to check parent stack status: plain text');
    consoleWarnSpy.mockRestore();
  });
});
