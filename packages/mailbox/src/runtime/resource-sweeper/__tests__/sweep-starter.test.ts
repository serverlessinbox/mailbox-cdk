/**
 * Coverage for `SweepStarter`.
 * - Delete guard: a Delete sweeps only while the parent stack is being deleted. CloudFormation also
 *   sends Delete to a replaced DeferredRemoval of a stack that stays alive, and sweeping then destroys
 *   the live stack-failure detector and edge function; loosening the guard re-opens that defect.
 *   Create and Update must not consult the stack status at all.
 * - Reap-on-start: before calling `StartExecution` the starter stops any execution still `RUNNING`,
 *   which caps how long a stale execution — e.g. one left running by a deploy whose state machine
 *   lacked self-cleanup — can outlive the deploy that started it.
 * - Best-effort start: when there is nothing to sweep it must not touch Step Functions, and a
 *   StartExecution failure must not be thrown, or the custom resource would stop answering
 *   CloudFormation and leave the stack waiting out the service timeout. The failure must still be
 *   logged at error level, since a lower level would be discarded at the default log level.
 */

import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import type { StackStatus }                            from '@aws-sdk/client-cloudformation';
import {
  SFNClient,
  StartExecutionCommand,
  ListExecutionsCommand,
  StopExecutionCommand,
} from '@aws-sdk/client-sfn';
import { mockClient } from 'aws-sdk-client-mock';

import {
  PARENT_STACK_ID,
  STATE_MACHINE_ARN,
  OLD_REMOVAL_ENTRY,
  createSweepStarter,
  createEvent,
  deleteEvent,
  updateEvent,
} from './sweep-helpers';

const sfnMock = mockClient(SFNClient);
const cfnMock = mockClient(CloudFormationClient);

const STALE_EXECUTION_ARN = 'arn:aws:states:us-west-2:123456789012:execution:mailbox-sweeper-ops-abc123:stale';

function parentStackInStatus(status: StackStatus): void {
  cfnMock.on(DescribeStacksCommand).resolves({
    Stacks: [{ StackName: 'parent', CreationTime: new Date(), StackStatus: status }],
  });
}

function commandNames(): string[] {
  return sfnMock.calls().map((call) => call.args[0].constructor.name);
}

describe('SweepStarter', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    sfnMock.reset();
    cfnMock.reset();
    sfnMock.on(ListExecutionsCommand).resolves({ executions: [] });
    sfnMock.on(StartExecutionCommand).resolves({ executionArn: 'arn:execution', startDate: new Date() });
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Delete guard', () => {
    it('starts the sweep with the Delete targets when the parent stack is being deleted', async () => {
      parentStackInStatus('DELETE_IN_PROGRESS');

      await createSweepStarter().handle(deleteEvent());

      expect(cfnMock.commandCalls(DescribeStacksCommand)[0].args[0].input).toEqual({ StackName: PARENT_STACK_ID });
      const start = sfnMock.commandCalls(StartExecutionCommand);
      expect(start).toHaveLength(1);
      expect(JSON.parse(start[0].args[0].input.input ?? '')).toEqual({ toSweep: { cert: OLD_REMOVAL_ENTRY } });
    });

    it('starts no execution when the parent stack is not being deleted', async () => {
      parentStackInStatus('UPDATE_COMPLETE');

      await createSweepStarter().handle(deleteEvent());

      expect(sfnMock.commandCalls(ListExecutionsCommand)).toHaveLength(0);
      expect(sfnMock.commandCalls(StartExecutionCommand)).toHaveLength(0);
    });

    it('does not consult the stack status on Update, which still sweeps the removed entry', async () => {
      await createSweepStarter().handle(updateEvent());

      expect(cfnMock.commandCalls(DescribeStacksCommand)).toHaveLength(0);
      const start = sfnMock.commandCalls(StartExecutionCommand);
      expect(JSON.parse(start[0].args[0].input.input ?? '')).toEqual({ toSweep: { cert: OLD_REMOVAL_ENTRY } });
    });
  });

  describe('reap-on-start', () => {
    beforeEach(() => {
      parentStackInStatus('DELETE_IN_PROGRESS');
    });

    it('stops a RUNNING execution before starting a new one', async () => {
      sfnMock.on(ListExecutionsCommand).resolves({
        executions: [
          {
            executionArn:    STALE_EXECUTION_ARN,
            stateMachineArn: STATE_MACHINE_ARN,
            name:            'stale',
            status:          'RUNNING',
            startDate:       new Date(),
          },
        ],
      });
      sfnMock.on(StopExecutionCommand).resolves({});

      await createSweepStarter().handle(deleteEvent());

      expect(commandNames()).toEqual(['ListExecutionsCommand', 'StopExecutionCommand', 'StartExecutionCommand']);
      expect(sfnMock.commandCalls(ListExecutionsCommand)[0].args[0].input).toMatchObject({
        stateMachineArn: STATE_MACHINE_ARN,
        statusFilter:    'RUNNING',
      });
      expect(sfnMock.commandCalls(StopExecutionCommand)[0].args[0].input).toMatchObject({
        executionArn: STALE_EXECUTION_ARN,
      });
    });

    it('starts directly, with no StopExecution call, when nothing is RUNNING', async () => {
      await createSweepStarter().handle(deleteEvent());

      expect(commandNames()).toEqual(['ListExecutionsCommand', 'StartExecutionCommand']);
    });
  });

  describe('starting the sweep', () => {
    it('makes no Step Functions call when the request has nothing to sweep', async () => {
      await createSweepStarter().handle(createEvent());

      expect(sfnMock.calls()).toHaveLength(0);
    });

    it('starts the execution on the configured state machine, named after the request id', async () => {
      await createSweepStarter().handle(updateEvent());

      expect(sfnMock.commandCalls(StartExecutionCommand)[0].args[0].input).toEqual({
        stateMachineArn: STATE_MACHINE_ARN,
        name:            'request-1',
        input:           JSON.stringify({ toSweep: { cert: OLD_REMOVAL_ENTRY } }),
      });
    });

    it('treats ExecutionAlreadyExists as success without logging an error', async () => {
      sfnMock.on(StartExecutionCommand).rejects(
        Object.assign(new Error('already exists'), { name: 'ExecutionAlreadyExists' }),
      );

      await expect(createSweepStarter().handle(updateEvent())).resolves.toBeUndefined();

      expect(consoleError).not.toHaveBeenCalled();
    });

    it('logs any other StartExecution failure at error level without throwing', async () => {
      sfnMock.on(StartExecutionCommand).rejects(
        Object.assign(new Error('state machine is deleting'), { name: 'StateMachineDeleting' }),
      );

      await expect(createSweepStarter().handle(updateEvent())).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalledWith(
        'Failed to start SFN execution (best-effort, will not propagate)',
        expect.objectContaining({ errorName: 'StateMachineDeleting', errorMessage: 'state machine is deleting' }),
      );
    });
  });
});
