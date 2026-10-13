/**
 * Pins how bucket-auto-empty answers CloudFormation requests: only Delete empties a bucket, a request it
 * rejects on purpose is an ExpectedFailure (so the handler does not flush a trace for it), a failing call is
 * not, and a failed Update during a parent-stack rollback is suppressed. Answering FAILED to that Update
 * strands the stack in UPDATE_ROLLBACK_FAILED.
 */

import { CloudFormationClient, DescribeStacksCommand, type StackStatus } from '@aws-sdk/client-cloudformation';
import { S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { BucketAutoEmptyRequestHandler } from '../bucket-auto-empty-request-handler';
import { BucketEmptier } from '../bucket-emptier';
import { ExpectedFailure } from '../../shared/expected-failure';
import { LoggerBuffer } from '../../shared/logger-buffer';
import {
  PHYSICAL_RESOURCE_ID,
  fakeCreateEvent,
  fakeDeleteEvent,
  fakeUpdateEvent,
} from './bucket-auto-empty-helpers';

describe('BucketAutoEmptyRequestHandler', () => {
  const cloudFormationMock = mockClient(CloudFormationClient);
  const bucketEmptier = new BucketEmptier(new S3Client({}));
  const requestHandler = new BucketAutoEmptyRequestHandler(
    bucketEmptier,
    new CloudFormationClient({}),
    new LoggerBuffer('bucket-auto-empty', 'error'),
  );
  let emptyBucket: jest.SpiedFunction<BucketEmptier['empty']>;

  beforeEach(() => {
    cloudFormationMock.reset();
    emptyBucket = jest.spyOn(bucketEmptier, 'empty').mockResolvedValue(3);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handle', () => {
    it.each([
      ['Create', fakeCreateEvent({ bucketName: 'my-bucket' })],
      ['Update', fakeUpdateEvent({ bucketName: 'my-bucket' })],
    ])('answers %s without emptying anything', async (_requestType, request) => {
      const response = await requestHandler.handle(request);

      expect(response).toEqual({ PhysicalResourceId: PHYSICAL_RESOURCE_ID, Data: { deleted: '0' } });
      expect(emptyBucket).not.toHaveBeenCalled();
    });

    it('empties the trimmed bucket name on Delete and reports how many were deleted', async () => {
      const response = await requestHandler.handle(fakeDeleteEvent({ bucketName: ' my-bucket ' }));

      expect(emptyBucket).toHaveBeenCalledWith('my-bucket');
      expect(response).toEqual({ PhysicalResourceId: PHYSICAL_RESOURCE_ID, Data: { deleted: '3' } });
    });

    it('keeps the physical id CloudFormation sent on Delete', async () => {
      const response = await requestHandler.handle({
        ...fakeDeleteEvent({ bucketName: 'my-bucket' }),
        PhysicalResourceId: 'physical-id-from-cloudformation',
      });

      expect(response.PhysicalResourceId).toBe('physical-id-from-cloudformation');
    });

    it('derives the physical id on Delete when CloudFormation sent none', async () => {
      const response = await requestHandler.handle({
        ...fakeDeleteEvent({ bucketName: 'my-bucket' }),
        PhysicalResourceId: '',
      });

      expect(response.PhysicalResourceId).toBe(PHYSICAL_RESOURCE_ID);
    });

    it.each([
      ['no bucketName', { ...fakeDeleteEvent({}) }],
      ['a blank bucketName', { ...fakeDeleteEvent({ bucketName: '   ' }) }],
      ['no resource properties', { ...fakeDeleteEvent({}), ResourceProperties: undefined }],
    ])('rejects a Delete with %s as an expected failure', async (_case, request) => {
      const failure: unknown = await requestHandler.handle(request).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'Missing required property: bucketName');
      expect(emptyBucket).not.toHaveBeenCalled();
    });

    it('rejects invalid resource properties as an expected failure, before the request type is considered', async () => {
      const failure: unknown = await requestHandler
        .handle(fakeCreateEvent({ bucketName: 123 }))
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', expect.stringContaining('Invalid ResourceProperties'));
    });

    it('rejects an unknown request type as an expected failure', async () => {
      const failure: unknown = await requestHandler
        .handle({ ...fakeDeleteEvent({ bucketName: 'my-bucket' }), RequestType: 'Replace' })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'Unknown RequestType: Replace');
    });

    it('lets a failure to empty the bucket through as an unexpected error', async () => {
      emptyBucket.mockRejectedValue(new Error('AccessDenied'));

      const failure: unknown = await requestHandler
        .handle(fakeDeleteEvent({ bucketName: 'my-bucket' }))
        .catch((error: unknown) => error);

      expect(failure).not.toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'AccessDenied');
    });
  });

  describe('answerFailedRequest', () => {
    function parentStackIsIn(stackStatus: StackStatus): void {
      cloudFormationMock.on(DescribeStacksCommand).resolves({
        Stacks: [{ StackName: 'parent-stack', CreationTime: new Date(), StackStatus: stackStatus }],
      });
    }

    it('answers SUCCESS with the unchanged physical id to an Update failing during a rollback', async () => {
      parentStackIsIn('UPDATE_ROLLBACK_IN_PROGRESS');

      const answer = await requestHandler.answerFailedRequest(
        fakeUpdateEvent({ bucketName: 'my-bucket' }),
        new Error('boom'),
      );

      expect(answer).toEqual({ PhysicalResourceId: PHYSICAL_RESOURCE_ID });
    });

    it('lets the failure of an Update stand when the parent stack is not rolling back', async () => {
      parentStackIsIn('UPDATE_IN_PROGRESS');

      const answer = await requestHandler.answerFailedRequest(
        fakeUpdateEvent({ bucketName: 'my-bucket' }),
        new Error('boom'),
      );

      expect(answer).toBeUndefined();
    });

    it('lets the failure of an Update stand when the parent stack status cannot be read', async () => {
      cloudFormationMock.on(DescribeStacksCommand).rejects(new Error('Stack not found'));

      const answer = await requestHandler.answerFailedRequest(
        fakeUpdateEvent({ bucketName: 'my-bucket' }),
        new Error('boom'),
      );

      expect(answer).toBeUndefined();
    });

    it('lets the failure of a Create stand without reading the parent stack status', async () => {
      parentStackIsIn('UPDATE_ROLLBACK_IN_PROGRESS');

      const answer = await requestHandler.answerFailedRequest(
        fakeCreateEvent({ bucketName: 'my-bucket' }),
        new Error('boom'),
      );

      expect(answer).toBeUndefined();
      expect(cloudFormationMock.calls()).toHaveLength(0);
    });

    it('logs the failure reason at error level', async () => {
      await requestHandler.answerFailedRequest(fakeCreateEvent({ bucketName: 'my-bucket' }), new Error('boom'));

      expect(console.error).toHaveBeenCalledWith('Handler failed', { error: 'boom', service: 'bucket-auto-empty' });
    });
  });
});
