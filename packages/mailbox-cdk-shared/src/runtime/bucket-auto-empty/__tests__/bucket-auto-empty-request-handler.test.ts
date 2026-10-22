/**
 * Pins how bucket-auto-empty answers CloudFormation requests: only Delete empties a bucket, a request it
 * rejects on purpose is an ExpectedFailure (so the handler does not flush a trace for it), a failure of the
 * emptying call is not. A Delete whose bucket is already gone is answered as done: failing it would leave the
 * stack in DELETE_FAILED over a bucket that needs nothing.
 */

import { NoSuchBucket, S3Client }        from '@aws-sdk/client-s3';

import { readCustomResourceRequest }     from '../../../runtime/handler-kit/custom-resource/custom-resource-request-reader';
import { ExpectedFailure }               from '../../../runtime/handler-kit/errors/expected-failure';
import { LoggerBuffer }                  from '../../../runtime/handler-kit/logger-buffer';
import { BucketAutoEmptyRequestHandler } from '../bucket-auto-empty-request-handler';
import { BucketEmptier }                 from '../bucket-emptier';

import {
  PHYSICAL_RESOURCE_ID,
  fakeCreateEvent,
  fakeDeleteEvent,
  fakeUpdateEvent,
} from './bucket-auto-empty-helpers';

describe('BucketAutoEmptyRequestHandler', () => {
  const bucketEmptier  = new BucketEmptier(new S3Client({}));
  const requestHandler = new BucketAutoEmptyRequestHandler(bucketEmptier, new LoggerBuffer('bucket-auto-empty', 'error'));
  const deadline       = { getRemainingTimeInMillis: () => 900_000 };
  let emptyBucket: jest.SpiedFunction<BucketEmptier['empty']>;

  beforeEach(() => {
    emptyBucket = jest.spyOn(bucketEmptier, 'empty').mockResolvedValue(3);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('handle', () => {
    it.each([
      ['Create', readCustomResourceRequest(fakeCreateEvent({ bucketName: 'my-bucket' }))],
      ['Update', readCustomResourceRequest(fakeUpdateEvent({ bucketName: 'my-bucket' }))],
    ])('answers %s without emptying anything', async (...[, request]) => {
      const response = await requestHandler.handle(request, deadline);

      expect(response).toEqual({ PhysicalResourceId: PHYSICAL_RESOURCE_ID, Data: { deleted: '0' } });
      expect(emptyBucket).not.toHaveBeenCalled();
    });

    it('empties the trimmed bucket name on Delete, within the invocation deadline, and reports how many were deleted', async () => {
      const response = await requestHandler.handle(readCustomResourceRequest(fakeDeleteEvent({ bucketName: ' my-bucket ' })), deadline);

      expect(emptyBucket).toHaveBeenCalledWith('my-bucket', deadline);
      expect(response).toEqual({ PhysicalResourceId: PHYSICAL_RESOURCE_ID, Data: { deleted: '3' } });
    });

    it('keeps the physical id CloudFormation sent on Delete', async () => {
      const response = await requestHandler.handle(readCustomResourceRequest({
        ...fakeDeleteEvent({ bucketName: 'my-bucket' }),
        PhysicalResourceId: 'physical-id-from-cloudformation',
      }), deadline);

      expect(response.PhysicalResourceId).toBe('physical-id-from-cloudformation');
    });

    it('derives the physical id on Delete when CloudFormation sent an empty one', async () => {
      const response = await requestHandler.handle(readCustomResourceRequest({
        ...fakeDeleteEvent({ bucketName: 'my-bucket' }),
        PhysicalResourceId: '',
      }), deadline);

      expect(response.PhysicalResourceId).toBe(PHYSICAL_RESOURCE_ID);
    });

    it('answers a Delete whose bucket no longer exists as done, with nothing deleted', async () => {
      emptyBucket.mockRejectedValue(new NoSuchBucket({ message: 'The specified bucket does not exist', $metadata: {} }));

      const response = await requestHandler.handle(readCustomResourceRequest(fakeDeleteEvent({ bucketName: 'gone-bucket' })), deadline);

      expect(response).toEqual({ PhysicalResourceId: PHYSICAL_RESOURCE_ID, Data: { deleted: '0' } });
    });

    it.each([
      ['no bucketName', readCustomResourceRequest(fakeDeleteEvent({}))],
      ['a blank bucketName', readCustomResourceRequest(fakeDeleteEvent({ bucketName: '   ' }))],
      ['a bucketName that is not a string', readCustomResourceRequest(fakeDeleteEvent({ bucketName: 123 }))],
      ['no resource properties', readCustomResourceRequest({ ...fakeDeleteEvent({}), ResourceProperties: undefined })],
    ])('fails a Delete with %s, saying the bucket cannot be checked', async (...[, request]) => {
      const failure: unknown = await requestHandler.handle(request, deadline).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'Cannot check the bucket: bucketName is missing, blank or not a string');
      expect(emptyBucket).not.toHaveBeenCalled();
    });

    it('answers a Delete of a bucket that is already empty with SUCCESS and nothing deleted', async () => {
      emptyBucket.mockResolvedValue(0);

      const response = await requestHandler.handle(readCustomResourceRequest(fakeDeleteEvent({ bucketName: 'empty-bucket' })), deadline);

      expect(response).toEqual({ PhysicalResourceId: PHYSICAL_RESOURCE_ID, Data: { deleted: '0' } });
    });

    it('rejects invalid resource properties on Create as an expected failure', async () => {
      const failure: unknown = await requestHandler
        .handle(readCustomResourceRequest(fakeCreateEvent({ bucketName: 123 })), deadline)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', expect.stringContaining('Invalid ResourceProperties'));
    });

    it('lets a failure to empty the bucket through as an unexpected error', async () => {
      emptyBucket.mockRejectedValue(new Error('AccessDenied'));

      const failure: unknown = await requestHandler
        .handle(readCustomResourceRequest(fakeDeleteEvent({ bucketName: 'my-bucket' })), deadline)
        .catch((error: unknown) => error);

      expect(failure).not.toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'AccessDenied');
    });
  });
});
