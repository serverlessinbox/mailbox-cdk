/**
 * Coverage for the starter's reap-on-start behaviour (see `handler.ts`, `starterHandler`): before
 * calling `StartExecution`, the starter must stop any execution still `RUNNING` on the target state
 * machine. This caps how long a stale execution — left running by, e.g., a deploy that predates the
 * self-cleanup guard in `features/sweeper/sweeper-workflow.ts` — can outlive the deploy that started
 * it, and is the migration path for a stack that already has one wedged in place.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  SFNClient,
  StartExecutionCommand,
  ListExecutionsCommand,
  StopExecutionCommand,
} from '@aws-sdk/client-sfn';
import type { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import { starterHandler } from '../handler';

// wrapHandler PUTs the CFN response over real `https` — stub it so the handler resolves without a
// network call, mirroring how the smoke-test path in handler.test.ts avoids the real handler body.
jest.mock('https', () => ({
  request: jest.fn((_options: unknown, callback: (res: { statusCode: number; headers: {} }) => void) => {
    callback({ statusCode: 200, headers: {} });
    return { on: jest.fn(), end: jest.fn(), write: jest.fn() };
  }),
}));

const sfnMock = mockClient(SFNClient);

const SM_ARN = 'arn:aws:states:us-west-2:123456789012:stateMachine:mailbox-sweeper-ops-abc123';

function deleteEvent(): CloudFormationCustomResourceEvent {
  return {
    RequestType: 'Delete',
    ServiceToken: 'arn:aws:lambda:us-west-2:123456789012:function:starter',
    ResponseURL: 'https://example.com/response',
    StackId: 'arn:aws:cloudformation:us-west-2:123456789012:stack/test/abc',
    RequestId: 'request-1',
    LogicalResourceId: 'DeferredRemoval',
    ResourceType: 'Custom::DeferredRemoval',
    PhysicalResourceId: 'mailbox-deferred-removal',
    ResourceProperties: { cert: { certArn: 'arn:aws:acm:us-west-2:123456789012:certificate/abc' } } as any,
  };
}

function context(): Context {
  return {
    getRemainingTimeInMillis: () => 30000,
    logStreamName: '/aws/lambda/test',
    logGroupName: '/aws/lambda/test',
  } as unknown as Context;
}

describe('starterHandler — reap-on-start', () => {
  beforeEach(() => {
    sfnMock.reset();
    process.env['MAILBOX_SWEEPER_STATE_MACHINE_ARN'] = SM_ARN;
  });

  it('stops a RUNNING execution before starting a new one', async () => {
    sfnMock.on(ListExecutionsCommand).resolves({
      executions: [
        {
          executionArn: 'arn:aws:states:us-west-2:123456789012:execution:mailbox-sweeper-ops-abc123:stale',
          stateMachineArn: SM_ARN,
          name: 'stale',
          status: 'RUNNING',
          startDate: new Date(),
        },
      ],
    });
    sfnMock.on(StopExecutionCommand).resolves({});
    sfnMock.on(StartExecutionCommand).resolves({
      executionArn: 'arn:aws:states:us-west-2:123456789012:execution:mailbox-sweeper-ops-abc123:request-1',
      startDate: new Date(),
    });

    await starterHandler(deleteEvent(), context());

    const calls = sfnMock.calls().map((call) => call.args[0].constructor.name);
    expect(calls).toEqual(['ListExecutionsCommand', 'StopExecutionCommand', 'StartExecutionCommand']);

    const listCall = sfnMock.commandCalls(ListExecutionsCommand)[0];
    expect(listCall.args[0].input).toMatchObject({ stateMachineArn: SM_ARN, statusFilter: 'RUNNING' });

    const stopCall = sfnMock.commandCalls(StopExecutionCommand)[0];
    expect(stopCall.args[0].input).toMatchObject({
      executionArn: 'arn:aws:states:us-west-2:123456789012:execution:mailbox-sweeper-ops-abc123:stale',
    });
  });

  it('starts directly, with no StopExecution call, when nothing is RUNNING', async () => {
    sfnMock.on(ListExecutionsCommand).resolves({ executions: [] });
    sfnMock.on(StartExecutionCommand).resolves({
      executionArn: 'arn:aws:states:us-west-2:123456789012:execution:mailbox-sweeper-ops-abc123:request-1',
      startDate: new Date(),
    });

    await starterHandler(deleteEvent(), context());

    expect(sfnMock.commandCalls(StopExecutionCommand)).toHaveLength(0);
    const calls = sfnMock.calls().map((call) => call.args[0].constructor.name);
    expect(calls).toEqual(['ListExecutionsCommand', 'StartExecutionCommand']);
  });
});
