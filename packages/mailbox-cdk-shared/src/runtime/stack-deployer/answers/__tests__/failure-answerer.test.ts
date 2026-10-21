import { toPhysicalResourceId }                       from '../../../../runtime/handler-kit/custom-resource/custom-resource-identifiers';
import { ExpectedFailure }                            from '../../../../runtime/handler-kit/errors/expected-failure';
import { StackDeploymentEventReader }                 from '../../stack/stack-deployment-event-reader';
import { StackOperationFailure }                      from '../../stack/stack-operation-failure';
import { WorkerResult }                               from '../../worker-result';
import { AnswerDeliveryFailure }                      from '../answer-delivery-failure';
import { CfnResponder }                               from '../cfn-responder';
import { FailureAnswerer, type StackFailureAnswerer } from '../failure-answerer';
import type { UpdateRollbackAnswers }                 from '../update-rollback-answerer';

import {
  awsError,
  cfnRequest,
  fakeCfnEndpoint,
  LOG_STREAM_NAME,
  noPause,
  operation,
  rollbackAnswering,
  sfnEvent,
  silenceConsole,
  STACK_ID,
  STACK_NAME,
  stackDeployerProperties,
  US_WEST_2,
  type ConsoleSpies,
  type FakeCfnEndpoint,
} from '../../__tests__/stack-deployer-helpers';

/**
 * Pins that every failure of a deployer invocation is answered to CloudFormation exactly once, from whatever
 * the event still gives: an invocation that ends without an answer holds the custom resource until its
 * service timeout. The one event that cannot be answered, one without a response target, must fail loudly,
 * and an answer that could not be delivered must not be answered a second time.
 */
describe('FailureAnswerer', () => {
  const answerer = new FailureAnswerer(new StackDeploymentEventReader(), new CfnResponder(noPause), undefined);
  let endpoint: FakeCfnEndpoint;
  let consoleSpies: ConsoleSpies;

  beforeEach(() => {
    endpoint     = fakeCfnEndpoint();
    consoleSpies = silenceConsole();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('answerCfnRequest', () => {
    it.each([
      ['Create', 'FAILED'],
      ['Update', 'FAILED'],
      ['Delete', 'SUCCESS'],
    ] as const)('answers a %s request %s with the error named, when the failure is not an expected one', async (requestType, status) => {
      await answerer.answerCfnRequest(cfnRequest({ RequestType: requestType }), awsError('Boom', 'it broke'), LOG_STREAM_NAME);

      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: status, Reason: 'Unexpected error: Boom: it broke', PhysicalResourceId: STACK_NAME }),
      ]);
    });

    it.each([
      ['an ExpectedFailure', new ExpectedFailure('rejected on purpose')],
      ['a StackOperationFailure', new StackOperationFailure('Failed to start', awsError('Denied', 'no'))],
    ])('answers with the message of %s as it is', async (_description, failure) => {
      await answerer.answerCfnRequest(cfnRequest(), failure, LOG_STREAM_NAME);

      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: failure.message })]);
    });

    it('answers a request whose type and properties cannot be read FAILED, naming the resource MailboxStack', async () => {
      const event = { ...cfnRequest(), RequestType: 'Replace', ResourceProperties: 'none' };

      await answerer.answerCfnRequest(event, new Error('Invalid event: RequestType'), LOG_STREAM_NAME);

      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'FAILED', Reason: 'Unexpected error: Error: Invalid event: RequestType', PhysicalResourceId: 'MailboxStack' }),
      ]);
    });

    it.each(['Update', 'Delete'] as const)('answers a %s request whose stack name cannot be read with the physical id CloudFormation sent', async (requestType) => {
      const event = { ...cfnRequest({ RequestType: requestType, PhysicalResourceId: toPhysicalResourceId('sent-by-cloudformation') }), ResourceProperties: { stackName: 7 } };

      await answerer.answerCfnRequest(event, new Error('Invalid ResourceProperties'), LOG_STREAM_NAME);

      expect(endpoint.answers()).toEqual([expect.objectContaining({ PhysicalResourceId: 'sent-by-cloudformation' })]);
    });

    it('throws after writing a line that says nothing can be answered, when the event has no response target', async () => {
      const failure = new Error('Invalid event');

      await expect(answerer.answerCfnRequest({ RequestType: 'Create' }, failure, LOG_STREAM_NAME)).rejects.toThrow(
        'CloudFormation was not answered: the event carries no usable response target. Failure: Error: Invalid event',
      );

      expect(endpoint.answers()).toEqual([]);
      expect(consoleSpies.error).toHaveBeenCalledWith('CloudFormation cannot be answered: the event carries no usable response target', { error: 'Error: Invalid event' });
    });

    it('throws a failure to deliver an answer as it is and makes no second attempt to answer', async () => {
      const failure = new AnswerDeliveryFailure('Failed to PUT CloudFormation response (HTTP 403): expired (attempts: 1)');

      await expect(answerer.answerCfnRequest(cfnRequest(), failure, LOG_STREAM_NAME)).rejects.toBe(failure);

      expect(endpoint.answers()).toEqual([]);
    });
  });

  describe('an Update that would be answered FAILED', () => {
    const rolledBack    = () => rollbackAnswering(true);
    const notRolledBack = () => rollbackAnswering(false);
    const answererWith  = (rollback: UpdateRollbackAnswers) => new FailureAnswerer(new StackDeploymentEventReader(), new CfnResponder(noPause), rollback);
    const update        = sfnEvent({ op: operation({ requestType: 'Update', region: US_WEST_2 }) });

    it('is offered to the rollback answerer as far as the request can be read, and left unanswered when that answers it', async () => {
      const rollback = rolledBack();
      const request  = cfnRequest({ RequestType: 'Update' }, stackDeployerProperties({ region: US_WEST_2 }));

      await answererWith(rollback).answerCfnRequest(request, awsError('Boom', 'it broke'), LOG_STREAM_NAME);

      expect(rollback.answerSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ requestType: 'Update', stackName: STACK_NAME, region: US_WEST_2 }),
        { cfn: expect.objectContaining({ StackId: STACK_ID }), physicalResourceId: STACK_NAME, logStreamName: LOG_STREAM_NAME },
        'Unexpected error: Boom: it broke',
      );
      expect(endpoint.answers()).toEqual([]);
    });

    it('is offered to the rollback answerer when a workflow input fails with anything but a StackOperationFailure, and the workflow ends unanswered when that answers it', async () => {
      const rollback = rolledBack();

      const result = await answererWith(rollback).answerSfnInput(update, awsError('Boom', 'it broke'), LOG_STREAM_NAME);

      expect(result).toEqual({ done: true });
      expect(rollback.answerSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ requestType: 'Update', stackName: STACK_NAME, region: US_WEST_2 }),
        expect.objectContaining({ physicalResourceId: STACK_NAME }),
        'Unexpected error: Boom: it broke',
      );
      expect(endpoint.answers()).toEqual([]);
    });

    it('is answered FAILED as before when the rollback answerer leaves it', async () => {
      const rollback = notRolledBack();

      await answererWith(rollback).answerCfnRequest(cfnRequest({ RequestType: 'Update' }), awsError('Boom', 'it broke'), LOG_STREAM_NAME);

      expect(rollback.answerSuccess).toHaveBeenCalledTimes(1);
      expect(endpoint.answers()).toEqual([expect.objectContaining({ Status: 'FAILED', Reason: 'Unexpected error: Boom: it broke' })]);
    });
  });

  describe('answerSfnInput', () => {
    let stackFailures: StackFailureAnswerer;

    beforeEach(() => {
      stackFailures = { answerFailure: jest.fn(async () => WorkerResult.finished()) };
    });

    it.each([
      ['Create', 'FAILED'],
      ['Delete', 'SUCCESS'],
    ] as const)('answers a %s workflow input %s with the error named and ends the workflow', async (requestType, status) => {
      const result = await answerer.answerSfnInput(sfnEvent({ op: operation({ requestType }) }), awsError('Boom', 'it broke'), LOG_STREAM_NAME);

      expect(result).toEqual({ done: true });
      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: status, Reason: 'Unexpected error: Boom: it broke', PhysicalResourceId: STACK_NAME }),
      ]);
    });

    it('answers a workflow input whose operation cannot be read, from its envelope, FAILED', async () => {
      const event = { cfn: sfnEvent().cfn, mode: 'check', op: 'none' };

      const result = await answerer.answerSfnInput(event, new Error('Invalid event: .op'), LOG_STREAM_NAME);

      expect(result).toEqual({ done: true });
      expect(endpoint.answers()).toEqual([
        expect.objectContaining({ Status: 'FAILED', Reason: 'Unexpected error: Error: Invalid event: .op', PhysicalResourceId: 'MailboxStack' }),
      ]);
    });

    it('leaves the answer of a StackOperationFailure to the stack failures, with the operation and the target of the input', async () => {
      const failure = new StackOperationFailure('Stack deployer check failed', awsError('Denied', 'no'));
      const event   = sfnEvent();

      await answerer.answerSfnInput(event, failure, LOG_STREAM_NAME, stackFailures);

      expect(stackFailures.answerFailure).toHaveBeenCalledWith(event.op, failure, { cfn: event.cfn, physicalResourceId: STACK_NAME, logStreamName: LOG_STREAM_NAME });
      expect(endpoint.answers()).toEqual([]);
    });

    it('answers a workflow input whose operation cannot be read with the physical id CloudFormation sent', async () => {
      const event = { cfn: { ...sfnEvent().cfn, PhysicalResourceId: 'sent-by-cloudformation' }, mode: 'check', op: 'none' };

      await answerer.answerSfnInput(event, new Error('Invalid event: .op'), LOG_STREAM_NAME);

      expect(endpoint.answers()).toEqual([expect.objectContaining({ PhysicalResourceId: 'sent-by-cloudformation' })]);
    });

    it('throws after writing a line that says nothing can be answered, when the input has no response target', async () => {
      await expect(answerer.answerSfnInput({ mode: 'check' }, new Error('Invalid event'), LOG_STREAM_NAME)).rejects.toThrow('CloudFormation was not answered');

      expect(endpoint.answers()).toEqual([]);
      expect(consoleSpies.error).toHaveBeenCalledWith('CloudFormation cannot be answered: the event carries no usable response target', { error: 'Error: Invalid event' });
    });

    it('throws a failure to deliver an answer as it is and makes no second attempt to answer', async () => {
      const failure = new AnswerDeliveryFailure('Failed to PUT CloudFormation response: TypeError: fetch failed (attempts: 4)');

      await expect(answerer.answerSfnInput(sfnEvent(), failure, LOG_STREAM_NAME, stackFailures)).rejects.toBe(failure);

      expect(endpoint.answers()).toEqual([]);
    });
  });
});
