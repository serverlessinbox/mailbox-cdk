import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStackEventsCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  type StackEvent,
} from '@aws-sdk/client-cloudformation';
import { mockClient }                 from 'aws-sdk-client-mock';

import { AnswerDeliveryFailure }      from '../answers/answer-delivery-failure';
import { CfnResponder }               from '../answers/cfn-responder';
import type { UpdateRollbackAnswers } from '../answers/update-rollback-answerer';
import { CloudFormationStacks }       from '../cloudformation-stacks';
import type { OperationInput }        from '../stack/stack-deployment';
import { StackOperationFailure }      from '../stack/stack-operation-failure';
import { StackDeployerWorker }        from '../stack-deployer-worker';

import {
  awsError,
  defaultLevelLogger,
  fakeCfnEndpoint,
  LOG_STREAM_NAME,
  noPause,
  operation,
  replyTarget,
  rollbackAnswering,
  sfnEvent,
  silenceConsole,
  stack,
  STACK_NAME,
  US_EAST_1,
  type ConsoleSpies,
  type FakeCfnEndpoint,
} from './stack-deployer-helpers';

function failedEvent(reason: string): StackEvent {
  return {
    StackId: 's',
    EventId: reason,
    StackName: STACK_NAME,
    Timestamp: new Date(),
    LogicalResourceId: 'DynamoDBTable',
    ResourceType: 'AWS::DynamoDB::Table',
    ResourceStatus: 'CREATE_FAILED',
    ResourceStatusReason: reason,
  };
}

const KMS_EVENT = failedEvent('KMS validation error: NotFoundException for alias/aws/dynamodb');

function deletionOf(overrides: Partial<OperationInput> = {}): OperationInput {
  return operation({ requestType: 'Delete', ...overrides });
}

/**
 * Pins how the worker drives one stack operation through the Step Functions workflow: what each start and
 * check returns to the workflow, and what CloudFormation is answered when the operation ends. A wrong result
 * here makes the workflow poll a finished stack for an hour or answer CloudFormation before the stack is
 * done; a Delete answered FAILED blocks the parent stack from deleting.
 */
describe('StackDeployerWorker', () => {
  const cfn = mockClient(CloudFormationClient);
  let endpoint: FakeCfnEndpoint;
  let consoleSpies: ConsoleSpies;

  const notRollingBack: UpdateRollbackAnswers = { answerSuccess: async () => false };

  function workerForStacks(rollback: UpdateRollbackAnswers = notRollingBack): StackDeployerWorker {
    const logger = defaultLevelLogger();
    const stacks = new CloudFormationStacks((region) => new CloudFormationClient({ region }), US_EAST_1, logger);
    return new StackDeployerWorker(stacks, new CfnResponder(noPause), rollback, logger);
  }

  beforeEach(() => {
    cfn.reset();
    cfn.on(DescribeStackEventsCommand).resolves({ StackEvents: [] });
    consoleSpies = silenceConsole();
    endpoint     = fakeCfnEndpoint();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('starting a stack operation', () => {
    const start = (op: OperationInput) => workerForStacks().handle(sfnEvent({ mode: 'start', op, attempt: 0 }), replyTarget());

    it('creates a stack that does not exist and asks the workflow to poll, without counters', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [] });

      const result = await start(operation());

      expect(result).toEqual({ done: false });
      expect(cfn.commandCalls(CreateStackCommand)).toHaveLength(1);
      expect(endpoint.answers()).toEqual([]);
    });

    it('updates a stack that exists', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });

      const result = await start(operation({ requestType: 'Update' }));

      expect(result).toEqual({ done: false });
      expect(cfn.commandCalls(UpdateStackCommand)).toHaveLength(1);
    });

    it('deletes the stack of a Delete and asks the workflow to poll', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });

      const result = await start(deletionOf());

      expect(result).toEqual({ done: false });
      expect(cfn.commandCalls(DeleteStackCommand)[0].args[0].input).toEqual({ StackName: STACK_NAME });
    });

    it.each([true, 'true'] as const)('leaves the stack of a Delete in place, answers SUCCESS and ends the workflow when preserveOnDelete is %j', async (preserveOnDelete) => {
      const result = await start(deletionOf({ preserveOnDelete }));

      expect(result).toEqual({ done: true });
      expect(cfn.calls()).toHaveLength(0);
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS', PhysicalResourceId: STACK_NAME, Data: {} })]);
    });

    it.each([false, 'false'] as const)('deletes the stack of a Delete when preserveOnDelete is %j', async (preserveOnDelete) => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_COMPLETE')] });

      const result = await start(deletionOf({ preserveOnDelete }));

      expect(result).toEqual({ done: false });
      expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(1);
    });

    it('throws the delivery failure as it is, not a StackOperationFailure, when the preserved-on-delete answer cannot be delivered', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('forbidden', { status: 403 }));

      const failure = await start(deletionOf({ preserveOnDelete: true })).catch((thrown: unknown) => thrown);

      expect(failure).toBeInstanceOf(AnswerDeliveryFailure);
    });

    it('throws a StackOperationFailure naming the start step when an AWS call fails', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [] });
      cfn.on(CreateStackCommand).rejects({ name: 'AccessDenied', message: 'cannot create' });

      await expect(start(operation())).rejects.toThrow(new StackOperationFailure('Stack deployer start failed', awsError('AccessDenied', 'cannot create')));
    });
  });

  describe('checking a deployment (Create and Update)', () => {
    const check = (overrides: Partial<ReturnType<typeof sfnEvent>> = {}) => workerForStacks().handle(sfnEvent(overrides), replyTarget());

    it('answers SUCCESS with the stack outputs and ends the workflow when the stack is complete', async () => {
      cfn.on(DescribeStacksCommand).resolves({
        Stacks: [stack('CREATE_COMPLETE', { Outputs: [{ OutputKey: 'TableName', OutputValue: 'items' }] })],
      });

      const result = await check();

      expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
      expect(endpoint.answers()).toEqual([
        { Status: 'SUCCESS', Reason: `See CloudWatch Log Stream: ${LOG_STREAM_NAME}`, PhysicalResourceId: STACK_NAME, StackId: sfnEvent().cfn.StackId, RequestId: 'request-123', LogicalResourceId: 'MailboxDeployer', NoEcho: false, Data: { TableName: 'items' } },
      ]);
    });

    it('asks the workflow to poll again while the stack is in progress, carrying the counters, without answering', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('UPDATE_IN_PROGRESS')] });

      const result = await check({ deleteRetryCount: 4, createRetryCount: 2 });

      expect(result).toEqual({ done: false, deleteRetryCount: 4, createRetryCount: 2 });
      expect(endpoint.answers()).toEqual([]);
    });

    it('starts counting attempts and retries at zero when the workflow input carries none', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('UPDATE_IN_PROGRESS')] });

      const result = await check({ attempt: undefined });

      expect(result).toEqual({ done: false, deleteRetryCount: 0, createRetryCount: 0 });
    });

    it('answers FAILED with the status reason and the recent events when the stack failed', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_FAILED', { StackStatusReason: 'Resource creation failed' })] });
      cfn.on(DescribeStackEventsCommand).resolves({ StackEvents: [failedEvent('Access Denied')] });

      const result = await check();

      expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
      expect(endpoint.answers()).toEqual([
        expect.objectContaining({
          Status: 'FAILED',
          Reason: 'Resource creation failed Recent events: DynamoDBTable (AWS::DynamoDB::Table) CREATE_FAILED: Access Denied',
        }),
      ]);
    });

    it('names the status when a failed stack gives no reason', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('UPDATE_ROLLBACK_COMPLETE')] });

      await check();

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: 'Stack failed with status UPDATE_ROLLBACK_COMPLETE' })]);
    });

    it('answers FAILED that the stack does not exist, and ends the workflow', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [] });

      const result = await check();

      expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: `Stack ${STACK_NAME} does not exist` })]);
    });

    it.each(['DELETE_IN_PROGRESS', 'DELETE_COMPLETE', 'DELETE_FAILED'] as const)(
      'answers FAILED instead of polling when the stack being deployed is %s',
      async (status) => {
        cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack(status)] });
        cfn.on(DescribeStackEventsCommand).resolves({ StackEvents: [failedEvent('Access Denied')] });

        const result = await check();

        expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
        expect(endpoint.answers()).toEqual([
          expect.objectContaining({
            Status: 'FAILED',
            Reason: `Stack ${STACK_NAME} is being deleted (status ${status}); cannot deploy into a deleting stack. Recent events: DynamoDBTable (AWS::DynamoDB::Table) CREATE_FAILED: Access Denied`,
          }),
        ]);
      },
    );

    it('answers FAILED when the stack is still in progress at the 135th attempt', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_IN_PROGRESS')] });

      const result = await check({ attempt: 135 });

      expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'FAILED', Reason: `Stack ${STACK_NAME} did not reach a terminal state after 135 attempts (last status CREATE_IN_PROGRESS)` }),
      ]);
    });

    it('keeps polling at the 134th attempt', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('CREATE_IN_PROGRESS')] });

      const result = await check({ attempt: 134 });

      expect(result.done).toBe(false);
      expect(endpoint.answers()).toEqual([]);
    });

    it('answers FAILED past the cap as well', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('UPDATE_IN_PROGRESS')] });

      await check({ attempt: 136 });

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: expect.stringContaining('after 136 attempts') })]);
    });

    it('throws a StackOperationFailure naming the check step when the stack cannot be described', async () => {
      cfn.on(DescribeStacksCommand).rejects({ name: 'AccessDenied', message: 'cannot describe' });

      await expect(check()).rejects.toThrow('Stack deployer check failed (DescribeStacks): AccessDenied: cannot describe');
    });
  });

  describe('a Create that fails on a KMS key that is not available yet', () => {
    const checkCreate = (createRetryCount?: number, requestType: OperationInput['requestType'] = 'Create') =>
      workerForStacks().handle(sfnEvent({ op: operation({ requestType }), createRetryCount }), replyTarget());

    beforeEach(() => {
      cfn.on(DescribeStackEventsCommand).resolves({ StackEvents: [KMS_EVENT] });
    });

    it('waits for the rollback to end without deleting or creating', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_IN_PROGRESS')] });

      const result = await checkCreate(0);

      expect(result).toEqual({ done: false, deleteRetryCount: 0, createRetryCount: 0 });
      expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(0);
      expect(cfn.commandCalls(CreateStackCommand)).toHaveLength(0);
      expect(endpoint.answers()).toEqual([]);
    });

    it.each(['ROLLBACK_COMPLETE', 'ROLLBACK_FAILED'] as const)('deletes and creates the stack again from %s and counts the retry', async (status) => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack(status)] });

      const result = await checkCreate(1);

      expect(result).toEqual({ done: false, deleteRetryCount: 0, createRetryCount: 2 });
      expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(1);
      expect(cfn.commandCalls(CreateStackCommand)).toHaveLength(1);
      expect(endpoint.answers()).toEqual([]);
    });

    it('still retries on the last retry within the budget', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_COMPLETE')] });

      const result = await checkCreate(2);

      expect(result).toEqual({ done: false, deleteRetryCount: 0, createRetryCount: 3 });
    });

    it('counts a retry whose create fails, and keeps polling', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_COMPLETE')] });
      cfn.on(CreateStackCommand).rejects({ name: 'LimitExceededException', message: 'too many stacks' });

      const result = await checkCreate(0);

      expect(result).toEqual({ done: false, deleteRetryCount: 0, createRetryCount: 1 });
      expect(consoleSpies.error).toHaveBeenCalledWith('Recreate CreateStack failed', expect.objectContaining({ error: expect.stringContaining('LimitExceededException') }));
    });

    it('answers FAILED once the retry budget of three is spent', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_COMPLETE', { StackStatusReason: 'Failed to create stack' })] });

      const result = await checkCreate(3);

      expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 3 });
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: expect.stringContaining('Failed to create stack') })]);
      expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(0);
    });

    it('does not recreate the stack of an Update', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_COMPLETE')] });

      const result = await checkCreate(0, 'Update');

      expect(result.done).toBe(true);
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED' })]);
      expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(0);
    });

    it('does not wait for a rollback that is not a Create', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_IN_PROGRESS')] });

      const result = await checkCreate(0, 'Update');

      expect(result.done).toBe(true);
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED' })]);
    });

    it('recognises the failure whatever the case of its text', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_COMPLETE')] });
      cfn.on(DescribeStackEventsCommand).resolves({ StackEvents: [failedEvent('kms: NOTFOUNDEXCEPTION')] });

      const result = await checkCreate(0);

      expect(result.done).toBe(false);
    });

    it('does not retry a failure that mentions the exception but not KMS', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_COMPLETE')] });
      cfn.on(DescribeStackEventsCommand).resolves({ StackEvents: [failedEvent('NotFoundException: the queue does not exist')] });

      const result = await checkCreate(0);

      expect(result.done).toBe(true);
      expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(0);
    });

    it('does not retry a failure that mentions KMS but not the exception', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_COMPLETE')] });
      cfn.on(DescribeStackEventsCommand).resolves({ StackEvents: [failedEvent('KMS key policy rejected')] });

      const result = await checkCreate(0);

      expect(result.done).toBe(true);
      expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(0);
    });
  });

  describe('checking a deletion', () => {
    const check = (overrides: Partial<ReturnType<typeof sfnEvent>> = {}) =>
      workerForStacks().handle(sfnEvent({ op: deletionOf(), ...overrides }), replyTarget());

    it('answers SUCCESS and ends the workflow when the stack is gone', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [] });

      const result = await check({ deleteRetryCount: 2 });

      expect(result).toEqual({ done: true, deleteRetryCount: 2, createRetryCount: 0 });
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS', Data: {} })]);
    });

    it('asks the workflow to poll again while the stack is being deleted', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('DELETE_IN_PROGRESS')] });

      const result = await check({ attempt: 134 });

      expect(result).toEqual({ done: false, deleteRetryCount: 0, createRetryCount: 0 });
      expect(endpoint.answers()).toEqual([]);
    });

    it('deletes the stack again after DELETE_FAILED and counts the retry', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('DELETE_FAILED')] });

      const result = await check({ deleteRetryCount: 3, createRetryCount: 1 });

      expect(result).toEqual({ done: false, deleteRetryCount: 4, createRetryCount: 1 });
      expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(1);
      expect(endpoint.answers()).toEqual([]);
    });

    it('counts the retry and keeps polling when deleting again fails', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('DELETE_FAILED')] });
      cfn.on(DeleteStackCommand).rejects({ name: 'AccessDenied', message: 'cannot delete' });

      const result = await check();

      expect(result).toEqual({ done: false, deleteRetryCount: 1, createRetryCount: 0 });
      expect(endpoint.answers()).toEqual([]);
    });

    it('answers SUCCESS with the status reason at the 135th attempt instead of deleting again when the stack is still DELETE_FAILED', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('DELETE_FAILED', { StackStatusReason: 'replica cleanup pending' })] });

      const result = await check({ attempt: 135, deleteRetryCount: 134 });

      expect(result).toEqual({ done: true, deleteRetryCount: 134, createRetryCount: 0 });
      expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(0);
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS', Reason: 'replica cleanup pending' })]);
    });

    it('answers CloudFormation once, within the poll cap, when the stack never leaves DELETE_FAILED', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('DELETE_FAILED')] });

      // Drives the worker the way the workflow does: one check per attempt, the attempt counted after each.
      let attempt = 0;
      let result  = await check({ attempt });
      while (!result.done) {
        attempt += 1;
        expect(attempt).toBeLessThanOrEqual(135);
        result = await check({ attempt, deleteRetryCount: result.deleteRetryCount });
      }

      expect(attempt).toBe(135);
      expect(cfn.commandCalls(DeleteStackCommand)).toHaveLength(135);
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS' })]);
    });

    it('answers SUCCESS with the status reason and the recent events when the delete ended in a failed state', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('UPDATE_ROLLBACK_COMPLETE', { StackStatusReason: 'Delete rolled back' })] });
      cfn.on(DescribeStackEventsCommand).resolves({ StackEvents: [failedEvent('Bucket not empty')] });

      const result = await check();

      expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
      expect(endpoint.answers()).toEqual([
        expect.objectContaining({
          Status: 'SUCCESS',
          Reason: 'Delete rolled back Recent events: DynamoDBTable (AWS::DynamoDB::Table) CREATE_FAILED: Bucket not empty',
        }),
      ]);
    });

    it('names the status when a delete that ended in a failed state gives no reason', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('ROLLBACK_COMPLETE')] });

      await check();

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS', Reason: 'Stack delete failed with status ROLLBACK_COMPLETE' })]);
    });

    it('answers SUCCESS at the 135th attempt so a delete that never ends cannot block the parent stack', async () => {
      cfn.on(DescribeStacksCommand).resolves({ Stacks: [stack('DELETE_IN_PROGRESS')] });

      const result = await check({ attempt: 135 });

      expect(result).toEqual({ done: true, deleteRetryCount: 0, createRetryCount: 0 });
      expect(endpoint.answers()).toEqual([
        expect.objectContaining({
          Status: 'SUCCESS',
          Reason: 'Stack deletion still in progress after 135 attempts (DELETE_IN_PROGRESS); responding SUCCESS to unblock CloudFormation rollback.',
        }),
      ]);
    });

    it('throws a StackOperationFailure naming the check step when the stack cannot be described', async () => {
      cfn.on(DescribeStacksCommand).rejects({ name: 'AccessDenied', message: 'cannot describe' });

      await expect(check()).rejects.toThrow('Stack deployer check failed (DescribeStacks): AccessDenied: cannot describe');
    });
  });

  describe('an Update that would be answered FAILED', () => {
    const rolledBack = () => rollbackAnswering(true);
    const update     = operation({ requestType: 'Update' });
    const target     = replyTarget();

    it.each([
      ['the stack does not exist', { Stacks: [] }, 0, `Stack ${STACK_NAME} does not exist`],
      ['the stack is being deleted', { Stacks: [stack('DELETE_IN_PROGRESS')] }, 0, expect.stringContaining('is being deleted')],
      ['the stack ended in a failed state', { Stacks: [stack('UPDATE_ROLLBACK_COMPLETE', { StackStatusReason: 'rolled back' })] }, 0, expect.stringContaining('rolled back')],
      ['the stack is still in progress at the last attempt', { Stacks: [stack('UPDATE_IN_PROGRESS')] }, 135, expect.stringContaining('did not reach a terminal state')],
    ])('is offered to the rollback answerer, and left unanswered when that answers it, when %s', async (_description, described, attempt, reason) => {
      cfn.on(DescribeStacksCommand).resolves(described);
      const rollback = rolledBack();

      const result = await workerForStacks(rollback).handle(sfnEvent({ op: update, attempt }), target);

      expect(result.done).toBe(true);
      expect(rollback.answerSuccess).toHaveBeenCalledWith(update, target, reason);
      expect(endpoint.answers()).toEqual([]);
    });

    it('is offered to the rollback answerer with the failure of a StackOperationFailure, and left unanswered when that answers it', async () => {
      const rollback = rolledBack();
      const failure  = new StackOperationFailure('Stack deployer start failed', awsError('AccessDenied', 'cannot update'));

      const result = await workerForStacks(rollback).answerFailure(update, failure, target);

      expect(result).toEqual({ done: true });
      expect(rollback.answerSuccess).toHaveBeenCalledWith(update, target, failure.message);
      expect(endpoint.answers()).toEqual([]);
      expect(cfn.commandCalls(DescribeStackEventsCommand)).toHaveLength(0);
    });
  });

  describe('answerFailure', () => {
    it('answers FAILED with the reason of a StackOperationFailure and the recent events, and ends the workflow without counters', async () => {
      cfn.on(DescribeStackEventsCommand).resolves({ StackEvents: [failedEvent('Access Denied')] });
      const failure = new StackOperationFailure('Stack deployer start failed', awsError('AccessDenied', 'cannot create'));

      const result = await workerForStacks().answerFailure(operation(), failure, replyTarget());

      expect(result).toEqual({ done: true });
      expect(endpoint.answers()).toEqual([
        expect.objectContaining({
          Status: 'FAILED',
          Reason: 'Stack deployer start failed: AccessDenied: cannot create Recent events: DynamoDBTable (AWS::DynamoDB::Table) CREATE_FAILED: Access Denied',
        }),
      ]);
    });

    it('answers a Delete SUCCESS so the failure never blocks the parent stack', async () => {
      await workerForStacks().answerFailure(deletionOf(), new StackOperationFailure('Stack deployer start failed', awsError('E', 'boom')), replyTarget());

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'SUCCESS', Reason: 'Stack deployer start failed: E: boom' })]);
    });

    it('logs the failure at error level', async () => {
      await workerForStacks().answerFailure(operation(), new StackOperationFailure('Stack deployer start failed', awsError('E', 'boom')), replyTarget());

      expect(consoleSpies.error).toHaveBeenCalledWith('Stack deployer failed', { errorMessage: 'Stack deployer start failed: E: boom', service: 'stack-deployer' });
    });
  });
});
