import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { mockClient } from 'aws-sdk-client-mock';
import { toPhysicalResourceId } from '../../shared/custom-resource-identifiers';
import { CfnResponder } from '../cfn-responder';
import type { OperationInput } from '../stack-deployment';
import { UpdateRollbackAnswerer, type FailedRequest, type SubStackOutputs } from '../update-rollback-answerer';
import {
  defaultLevelLogger,
  fakeCfnEndpoint,
  noPause,
  replyTarget,
  silenceConsole,
  stack,
  STACK_ID,
  STACK_NAME,
  US_WEST_2,
  type ConsoleSpies,
  type FakeCfnEndpoint,
} from './stack-deployer-helpers';

const OLD_OUTPUTS = { TableName: 'items-old' };
const FAILURE = 'Stack deployer check failed';
const UPDATE: FailedRequest = { requestType: 'Update', stackName: STACK_NAME, region: US_WEST_2 };

/**
 * Pins when a failed request is answered SUCCESS instead of FAILED: an Update that fails while the parent
 * stack is in UPDATE_ROLLBACK_IN_PROGRESS. A FAILED answer there strands the parent in UPDATE_ROLLBACK_FAILED,
 * and a SUCCESS answer without the outputs fails the parent resources that read this resource's attributes,
 * so each of the other cases must leave the failure to the caller.
 */
describe('UpdateRollbackAnswerer', () => {
  const parentClient = new CloudFormationClient({});
  const parentStack = mockClient(parentClient);
  let subStacks: jest.Mocked<SubStackOutputs>;
  let endpoint: FakeCfnEndpoint;
  let consoleSpies: ConsoleSpies;
  let answerer: UpdateRollbackAnswerer;

  const parentIs = (status: Parameters<typeof stack>[0]): void => {
    parentStack.on(DescribeStacksCommand, { StackName: STACK_ID }).resolves({ Stacks: [stack(status)] });
  };

  beforeEach(() => {
    parentStack.reset();
    subStacks = { currentOutputs: jest.fn<Promise<Record<string, string> | undefined>, [OperationInput]>(async () => OLD_OUTPUTS) };
    consoleSpies = silenceConsole();
    endpoint = fakeCfnEndpoint();
    answerer = new UpdateRollbackAnswerer(parentClient, subStacks, new CfnResponder(noPause), defaultLevelLogger());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers SUCCESS with the physical id CloudFormation sent and the outputs the stack has now, when the parent stack is rolling back', async () => {
    parentIs('UPDATE_ROLLBACK_IN_PROGRESS');
    const target = replyTarget({ physicalResourceId: toPhysicalResourceId('sent-by-cloudformation') });

    const answered = await answerer.answerSuccess(UPDATE, target, FAILURE);

    expect(answered).toBe(true);
    expect(endpoint.answers()).toEqual([
      expect.objectContaining({
        Status: 'SUCCESS',
        PhysicalResourceId: 'sent-by-cloudformation',
        Data: OLD_OUTPUTS,
        Reason: `Answered SUCCESS because the parent stack is rolling back. The Update failed: ${FAILURE}`,
      }),
    ]);
    expect(subStacks.currentOutputs).toHaveBeenCalledWith({ requestType: 'Update', stackName: STACK_NAME, region: US_WEST_2 });
  });

  it('asks the parent stack named by the request about its status, through the client it was given', async () => {
    parentIs('UPDATE_ROLLBACK_IN_PROGRESS');

    await answerer.answerSuccess(UPDATE, replyTarget(), FAILURE);

    expect(parentStack.commandCalls(DescribeStacksCommand).map((call) => call.args[0].input)).toEqual([{ StackName: STACK_ID }]);
  });

  it('writes the suppressed failure at error level, so that it is visible whatever the log level', async () => {
    parentIs('UPDATE_ROLLBACK_IN_PROGRESS');

    await answerer.answerSuccess(UPDATE, replyTarget(), FAILURE);

    expect(consoleSpies.error).toHaveBeenCalledWith('Answering SUCCESS to an Update that failed while the parent stack rolls back', expect.objectContaining({ reason: FAILURE }));
  });

  it.each(['UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE', 'UPDATE_ROLLBACK_FAILED'] as const)(
    'leaves the failure of an Update to the caller when the parent stack is %s',
    async (status) => {
      parentIs(status);

      const answered = await answerer.answerSuccess(UPDATE, replyTarget(), FAILURE);

      expect(answered).toBe(false);
      expect(endpoint.answers()).toEqual([]);
      expect(subStacks.currentOutputs).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a Create', 'Create'],
    ['a Delete', 'Delete'],
    ['an unreadable', undefined],
  ] as const)('leaves the failure of %s request to the caller without asking the parent stack', async (_description, requestType) => {
    const answered = await answerer.answerSuccess({ ...UPDATE, requestType }, replyTarget(), FAILURE);

    expect(answered).toBe(false);
    expect(parentStack.calls()).toHaveLength(0);
    expect(endpoint.answers()).toEqual([]);
  });

  it('counts a parent stack whose status cannot be read as not rolling back', async () => {
    parentStack.on(DescribeStacksCommand).rejects({ name: 'AccessDenied', message: 'cannot describe the parent' });

    const answered = await answerer.answerSuccess(UPDATE, replyTarget(), FAILURE);

    expect(answered).toBe(false);
    expect(endpoint.answers()).toEqual([]);
    expect(subStacks.currentOutputs).not.toHaveBeenCalled();
  });

  it('leaves the failure to the caller, and writes it at error level, when the outputs of the stack cannot be read', async () => {
    parentIs('UPDATE_ROLLBACK_IN_PROGRESS');
    subStacks.currentOutputs.mockResolvedValue(undefined);

    const answered = await answerer.answerSuccess(UPDATE, replyTarget(), FAILURE);

    expect(answered).toBe(false);
    expect(endpoint.answers()).toEqual([]);
    expect(consoleSpies.error).toHaveBeenCalledWith(
      'An Update failed while the parent stack rolls back, and the outputs of the stack cannot be read',
      expect.objectContaining({ reason: FAILURE }),
    );
  });

  it('leaves the failure to the caller when the request names no stack to read the outputs of', async () => {
    parentIs('UPDATE_ROLLBACK_IN_PROGRESS');

    const answered = await answerer.answerSuccess({ requestType: 'Update', stackName: undefined, region: undefined }, replyTarget(), FAILURE);

    expect(answered).toBe(false);
    expect(subStacks.currentOutputs).not.toHaveBeenCalled();
    expect(endpoint.answers()).toEqual([]);
  });
});
