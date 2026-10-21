/**
 * Pins how content-deployer answers CloudFormation requests: Create and Update replace the content of each
 * source and then invalidate the cache, Delete leaves the bucket untouched, a request it rejects on purpose
 * is an ExpectedFailure (so the handler does not flush a trace for it), and a failing call is not. The S3 and
 * CloudFront operations are faked: they are owned by the shared modules.
 */

import { CloudFrontClient }                             from '@aws-sdk/client-cloudfront';
import { S3Client }                                     from '@aws-sdk/client-s3';

import { ExpectedFailure }                              from '../../../runtime/handler-kit/errors/expected-failure';
import { invalidateCloudFront }                         from '../../shared/cloudfront-invalidation';
import { deletePrefix, deployZipToPrefix, writeObject } from '../../shared/content-ops';
import { LoggerBuffer }                                 from '../../shared/logger-buffer';
import { ContentDeployerRequestHandler }                from '../content-deployer-request-handler';

import {
  PHYSICAL_RESOURCE_ID,
  REQUEST_ID,
  dataSource,
  fakeCreateEvent,
  fakeDeleteEvent,
  fakeLambdaContext,
  fakeUpdateEvent,
  zipSource,
} from './content-deployer-helpers';

jest.mock('../../shared/content-ops', () => ({
  deletePrefix: jest.fn(),
  deployZipToPrefix: jest.fn(),
  writeObject: jest.fn(),
}));
jest.mock('../../shared/cloudfront-invalidation', () => ({
  invalidateCloudFront: jest.fn(),
}));

describe('ContentDeployerRequestHandler', () => {
  const s3             = new S3Client({});
  const cloudFront     = new CloudFrontClient({});
  const requestHandler = new ContentDeployerRequestHandler(s3, cloudFront, new LoggerBuffer('content-deployer', 'error'));
  const invocation     = fakeLambdaContext();

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(deletePrefix).mockResolvedValue(0);
    jest.mocked(deployZipToPrefix).mockResolvedValue({ uploaded: 3 });
    jest.mocked(writeObject).mockResolvedValue(undefined);
    jest.mocked(invalidateCloudFront).mockResolvedValue({ invalidated: false });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
    return promise.catch((error: unknown) => error);
  }

  describe('handle', () => {
    it('writes a data source at its key with its metadata', async () => {
      const response = await requestHandler.handle(
        fakeCreateEvent({
          targetBucket: 'my-bucket',
          sources: [dataSource({ contentType: 'application/json', cacheControl: 'no-store' })],
        }),
        invocation,
      );

      expect(writeObject).toHaveBeenCalledWith(s3, {
        targetBucket: 'my-bucket',
        key: 'config/config.json',
        body: '{"a":1}',
        contentType: 'application/json',
        cacheControl: 'no-store',
      });
      expect(response).toEqual({
        PhysicalResourceId: PHYSICAL_RESOURCE_ID,
        Data: { deleted: '0', objectsWritten: '1', cacheInvalidated: 'false' },
      });
    });

    it('empties the prefix of a zip source before unpacking the archive into it', async () => {
      const response = await requestHandler.handle(
        fakeUpdateEvent({ targetBucket: 'my-bucket', sources: [zipSource({ sourceVersionId: 'v7' })] }),
        invocation,
      );

      expect(deletePrefix).toHaveBeenCalledWith(s3, 'my-bucket', 'content/');
      expect(deployZipToPrefix).toHaveBeenCalledWith(s3, {
        sourceBucket: 'artifacts-bucket',
        sourceKey: 'bundle.zip',
        sourceVersionId: 'v7',
        targetBucket: 'my-bucket',
        targetPrefix: 'content/',
      });
      expect(jest.mocked(deletePrefix).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(deployZipToPrefix).mock.invocationCallOrder[0],
      );
      expect(response.Data).toEqual({ deleted: '0', objectsWritten: '3', cacheInvalidated: 'false' });
    });

    it('adds up the objects written by every source', async () => {
      const response = await requestHandler.handle(
        fakeCreateEvent({ targetBucket: 'my-bucket', sources: [dataSource(), zipSource()] }),
        invocation,
      );

      expect(response.Data).toMatchObject({ objectsWritten: '4' });
    });

    it('deploys into the trimmed target bucket', async () => {
      await requestHandler.handle(
        fakeCreateEvent({ targetBucket: ' my-bucket ', sources: [dataSource()] }),
        invocation,
      );

      expect(writeObject).toHaveBeenCalledWith(s3, expect.objectContaining({ targetBucket: 'my-bucket' }));
    });

    it('invalidates the paths after deploying, with the request id as the caller reference', async () => {
      jest.mocked(invalidateCloudFront).mockResolvedValue({ invalidated: true });

      const response = await requestHandler.handle(
        fakeUpdateEvent({
          targetBucket: 'my-bucket',
          sources: [dataSource()],
          distributionId: 'E123ABC',
          invalidationPaths: ['/*'],
        }),
        invocation,
      );

      expect(invalidateCloudFront).toHaveBeenCalledWith(cloudFront, {
        distributionId: 'E123ABC',
        paths: ['/*'],
        callerReference: REQUEST_ID,
      });
      expect(jest.mocked(writeObject).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(invalidateCloudFront).mock.invocationCallOrder[0],
      );
      expect(response.Data).toMatchObject({ cacheInvalidated: 'true' });
    });

    it('invalidates without a target bucket when there are no sources to deploy', async () => {
      const response = await requestHandler.handle(
        fakeCreateEvent({ sources: [], distributionId: 'E123ABC', invalidationPaths: ['/*'] }),
        invocation,
      );

      expect(writeObject).not.toHaveBeenCalled();
      expect(invalidateCloudFront).toHaveBeenCalledTimes(1);
      expect(response.PhysicalResourceId).toBe(PHYSICAL_RESOURCE_ID);
    });

    it('answers a Delete with invalid properties without reading them, keeping the physical id CloudFormation sent', async () => {
      const response = await requestHandler.handle(
        {
          ...fakeDeleteEvent({ targetBucket: 123, sources: 'not-an-array' }),
          PhysicalResourceId: 'physical-id-from-cloudformation',
        },
        invocation,
      );

      expect(response).toEqual({
        PhysicalResourceId: 'physical-id-from-cloudformation',
        Data: { deleted: '0', objectsWritten: '0', cacheInvalidated: '0' },
      });
      expect(writeObject).not.toHaveBeenCalled();
      expect(deletePrefix).not.toHaveBeenCalled();
      expect(invalidateCloudFront).not.toHaveBeenCalled();
    });

    it('rejects invalid properties on Create as an expected failure and writes nothing', async () => {
      const failure = await rejectionOf(
        requestHandler.handle(
          fakeCreateEvent({ targetBucket: 'my-bucket', sources: 'not-an-array' }),
          invocation,
        ),
      );

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', expect.stringContaining('Invalid ResourceProperties'));
      expect(writeObject).not.toHaveBeenCalled();
    });

    it.each([
      ['no targetBucket', { sources: [dataSource()] }],
      ['a blank targetBucket', { targetBucket: '   ', sources: [dataSource()] }],
    ])('rejects sources with %s as an expected failure', async (_case, properties) => {
      const failure = await rejectionOf(requestHandler.handle(fakeCreateEvent(properties), invocation));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'Missing required property: targetBucket');
      expect(writeObject).not.toHaveBeenCalled();
    });

    it('rejects the next source as an expected failure naming what was deployed when the invocation is nearly out of time', async () => {
      const remainingTime = jest.fn<number, []>().mockReturnValueOnce(900_000).mockReturnValue(30_000);

      const failure = await rejectionOf(
        requestHandler.handle(
          fakeCreateEvent({ targetBucket: 'my-bucket', sources: [dataSource(), dataSource({ key: 'second.json' })] }),
          { ...invocation, getRemainingTimeInMillis: remainingTime },
        ),
      );

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty(
        'message',
        'Content was not fully deployed before the Lambda deadline: 1 of 2 sources were deployed; the remaining sources and the cache invalidation were not run',
      );
      expect(writeObject).toHaveBeenCalledTimes(1);
    });

    it('rejects the invalidation as an expected failure when the invocation is nearly out of time after the sources', async () => {
      const remainingTime = jest.fn<number, []>().mockReturnValueOnce(900_000).mockReturnValue(30_000);

      const failure = await rejectionOf(
        requestHandler.handle(
          fakeCreateEvent({
            targetBucket: 'my-bucket',
            sources: [dataSource()],
            distributionId: 'E123ABC',
            invalidationPaths: ['/*'],
          }),
          { ...invocation, getRemainingTimeInMillis: remainingTime },
        ),
      );

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty(
        'message',
        'Content was not fully deployed before the Lambda deadline: all sources were deployed; the cache invalidation was not run',
      );
      expect(invalidateCloudFront).not.toHaveBeenCalled();
    });

    it('lets a failing write through as an unexpected error', async () => {
      jest.mocked(writeObject).mockRejectedValue(new Error('AccessDenied'));

      const failure = await rejectionOf(
        requestHandler.handle(fakeCreateEvent({ targetBucket: 'my-bucket', sources: [dataSource()] }), invocation),
      );

      expect(failure).not.toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'AccessDenied');
    });
  });
});
