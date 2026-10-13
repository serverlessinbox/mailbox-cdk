/**
 * Coverage for the starter's Delete guard (see `handler.ts`, `starterHandler`): a Delete sweeps only
 * while the parent stack is being deleted. CloudFormation also sends Delete to a replaced
 * DeferredRemoval of a stack that stays alive, and sweeping then destroys the live stack-failure
 * detector and edge function; loosening the guard re-opens that defect. Create and Update must not
 * consult the stack status at all.
 */

process.env['SERVICE_NAME'] = 'resource-sweeper-starter';
process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN'] = 'arn:aws:states:us-west-2:123456789012:stateMachine:mailbox-sweeper-ops-abc123';

import { mockClient } from 'aws-sdk-client-mock';
import { SFNClient, StartExecutionCommand, ListExecutionsCommand } from '@aws-sdk/client-sfn';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import type { StackStatus } from '@aws-sdk/client-cloudformation';
import { starterHandler } from '../handler';
import {
  PARENT_STACK_ID,
  OLD_REMOVAL_ENTRY,
  captureCfnResponse,
  deleteEvent,
  updateEvent,
  lambdaContext,
} from './starter-test-helpers';

// wrapHandler PUTs the CFN response over real `https`; captureCfnResponse routes it into memory.
jest.mock('https', () => ({ request: jest.fn() }));

const sfnMock = mockClient(SFNClient);
const cfnMock = mockClient(CloudFormationClient);

function parentStackInStatus(status: StackStatus): void {
  cfnMock.on(DescribeStacksCommand).resolves({
    Stacks: [{ StackName: 'parent', CreationTime: new Date(), StackStatus: status }],
  });
}

describe('starterHandler — Delete guard', () => {
  let cfnResponse: ReturnType<typeof captureCfnResponse>;

  beforeEach(() => {
    sfnMock.reset();
    cfnMock.reset();
    sfnMock.on(ListExecutionsCommand).resolves({ executions: [] });
    sfnMock.on(StartExecutionCommand).resolves({ executionArn: 'arn:execution', startDate: new Date() });
    cfnResponse = captureCfnResponse();
  });

  it('starts the sweep with the Delete targets when the parent stack is being deleted', async () => {
    parentStackInStatus('DELETE_IN_PROGRESS');

    await starterHandler(deleteEvent(), lambdaContext());

    expect(cfnMock.commandCalls(DescribeStacksCommand)[0].args[0].input).toEqual({ StackName: PARENT_STACK_ID });
    const start = sfnMock.commandCalls(StartExecutionCommand);
    expect(start).toHaveLength(1);
    expect(JSON.parse(start[0].args[0].input.input ?? '')).toEqual({ toSweep: { cert: OLD_REMOVAL_ENTRY } });
    expect(cfnResponse().Status).toBe('SUCCESS');
  });

  it('answers SUCCESS without starting an execution when the parent stack is not being deleted', async () => {
    parentStackInStatus('UPDATE_COMPLETE');

    await starterHandler(deleteEvent(), lambdaContext());

    expect(sfnMock.commandCalls(ListExecutionsCommand)).toHaveLength(0);
    expect(sfnMock.commandCalls(StartExecutionCommand)).toHaveLength(0);
    expect(cfnResponse().Status).toBe('SUCCESS');
  });

  it('does not consult the stack status on Update, which still sweeps the removed entry', async () => {
    await starterHandler(updateEvent(), lambdaContext());

    expect(cfnMock.commandCalls(DescribeStacksCommand)).toHaveLength(0);
    const start = sfnMock.commandCalls(StartExecutionCommand);
    expect(JSON.parse(start[0].args[0].input.input ?? '')).toEqual({ toSweep: { cert: OLD_REMOVAL_ENTRY } });
  });
});
