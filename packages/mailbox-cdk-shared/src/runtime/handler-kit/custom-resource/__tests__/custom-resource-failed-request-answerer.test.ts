/**
 * Pins how a failed custom-resource request is answered: only an Update that fails while the parent stack
 * rolls back is turned into SUCCESS with the unchanged physical id, and every other failure stands.
 * Answering FAILED to that Update strands the stack in UPDATE_ROLLBACK_FAILED.
 */

import { CloudFormationClient, DescribeStacksCommand, type StackStatus } from '@aws-sdk/client-cloudformation';
import { mockClient }                                                    from 'aws-sdk-client-mock';

import { ExpectedFailure }                                               from '../../errors/expected-failure';
import { LoggerBuffer }                                                  from '../../logger-buffer';
import { FailedRequestAnswerer }                                         from '../custom-resource-failed-request-answerer';
import { ParentStackStatus }                                             from '../parent-stack-status';

import { cfnRequest, PHYSICAL_RESOURCE_ID }                              from './custom-resource-request-helpers';

describe('FailedRequestAnswerer', () => {
  const cloudFormationMock = mockClient(CloudFormationClient);
  const logger             = new LoggerBuffer('test-service', 'warn');
  const answerer           = new FailedRequestAnswerer(new ParentStackStatus(new CloudFormationClient({}), logger), logger);

  function parentStackIsIn(stackStatus: StackStatus): void {
    cloudFormationMock.on(DescribeStacksCommand).resolves({
      Stacks: [{ StackName: 'parent-stack', CreationTime: new Date(), StackStatus: stackStatus }],
    });
  }

  beforeEach(() => {
    cloudFormationMock.reset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers SUCCESS with the unchanged physical id to an Update failing during a rollback', async () => {
    parentStackIsIn('UPDATE_ROLLBACK_IN_PROGRESS');

    const answer = await answerer.answer(cfnRequest('Update'), new Error('boom'));

    expect(answer).toEqual({ PhysicalResourceId: PHYSICAL_RESOURCE_ID });
    expect(console.warn).toHaveBeenCalledWith('Suppressing error during stack rollback', {
      error:   'boom',
      service: 'test-service',
    });
  });

  it('reports the data the answerer was given in the answer to an Update failing during a rollback', async () => {
    parentStackIsIn('UPDATE_ROLLBACK_IN_PROGRESS');
    const answererWithData = new FailedRequestAnswerer(new ParentStackStatus(new CloudFormationClient({}), logger), logger, { temporaryPassword: 'kept' });

    const answer = await answererWithData.answer(cfnRequest('Update'), new Error('boom'));

    expect(answer).toEqual({ PhysicalResourceId: PHYSICAL_RESOURCE_ID, Data: { temporaryPassword: 'kept' } });
  });

  it('lets the failure of an Update stand when the parent stack is not rolling back', async () => {
    parentStackIsIn('UPDATE_IN_PROGRESS');

    const answer = await answerer.answer(cfnRequest('Update'), new Error('boom'));

    expect(answer).toBeUndefined();
  });

  it('lets the failure of an Update stand when the parent stack status cannot be read', async () => {
    cloudFormationMock.on(DescribeStacksCommand).rejects(new Error('Stack not found'));

    const answer = await answerer.answer(cfnRequest('Update'), new Error('boom'));

    expect(answer).toBeUndefined();
  });

  it.each(['Create', 'Delete'] as const)('lets the failure of a %s stand without reading the parent stack status', async (requestType) => {
    parentStackIsIn('UPDATE_ROLLBACK_IN_PROGRESS');

    const answer = await answerer.answer(cfnRequest(requestType), new Error('boom'));

    expect(answer).toBeUndefined();
    expect(cloudFormationMock.calls()).toHaveLength(0);
  });

  it('logs the message of an Error failure at error level', async () => {
    await answerer.answer(cfnRequest('Create'), new Error('boom'));

    expect(console.error).toHaveBeenCalledWith('Handler failed', { error: 'boom', service: 'test-service' });
  });

  it('writes nothing for an expected failure, which answers by its reason alone', async () => {
    await answerer.answer(cfnRequest('Create'), new ExpectedFailure('rejected on purpose'));

    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs a failure that is not an Error as its string form', async () => {
    await answerer.answer(cfnRequest('Create'), 'plain failure');

    expect(console.error).toHaveBeenCalledWith('Handler failed', { error: 'plain failure', service: 'test-service' });
  });
});
