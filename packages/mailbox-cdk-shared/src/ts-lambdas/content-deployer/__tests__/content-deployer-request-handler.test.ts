/**
 * Pins how content-deployer answers CloudFormation requests: Create and Update replace the content of each
 * source and then invalidate the cache, Delete leaves the bucket untouched, a request it rejects on purpose
 * is an ExpectedFailure (so the handler does not flush a trace for it), and a failing call is not. The S3 and
 * CloudFront operations are faked: they are owned by the shared modules.
 */

import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { S3Client } from '@aws-sdk/client-s3';
import { deletePrefix, deployZipToPrefix, writeObject } from '../../shared/content-ops';
import { ExpectedFailure } from '../../shared/expected-failure';
import { LoggerBuffer } from '../../shared/logger-buffer';
import { invalidateCloudFront } from '../../shared/ui-cloudfront';
import { ContentDeployerRequestHandler } from '../content-deployer-request-handler';
import {
  LOG_GROUP_NAME,
  PHYSICAL_RESOURCE_ID,
  REQUEST_ID,
  dataSource,
  fakeCreateEvent,
  fakeDeleteEvent,
  fakeUpdateEvent,
  zipSource,
} from './content-deployer-helpers';

jest.mock('../../shared/content-ops', () => ({
  deletePrefix: jest.fn(),
  deployZipToPrefix: jest.fn(),
  writeObject: jest.fn(),
}));
jest.mock('../../shared/ui-cloudfront', () => ({
  invalidateCloudFront: jest.fn(),
}));

describe('ContentDeployerRequestHandler', () => {
  const s3 = new S3Client({});
  const cloudFront = new CloudFrontClient({});
  const requestHandler = new ContentDeployerRequestHandler(s3, cloudFront, new LoggerBuffer('content-deployer', 'error'));

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
        LOG_GROUP_NAME,
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
        LOG_GROUP_NAME,
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
        LOG_GROUP_NAME,
      );

      expect(response.Data).toMatchObject({ objectsWritten: '4' });
    });

    it('deploys into the trimmed target bucket', async () => {
      await requestHandler.handle(
        fakeCreateEvent({ targetBucket: ' my-bucket ', sources: [dataSource()] }),
        LOG_GROUP_NAME,
      );

      expect(writeObject).toHaveBeenCalledWith(s3, expect.objectContaining({ targetBucket: 'my-bucket' }));
    });

    it('invalidates the paths after deploying, with a caller reference built from the request', async () => {
      jest.mocked(invalidateCloudFront).mockResolvedValue({ invalidated: true });

      const response = await requestHandler.handle(
        fakeUpdateEvent({
          targetBucket: 'my-bucket',
          sources: [dataSource()],
          distributionId: 'E123ABC',
          invalidationPaths: ['/*'],
          deploymentNonce: 'nonce-1',
        }),
        LOG_GROUP_NAME,
      );

      expect(invalidateCloudFront).toHaveBeenCalledWith(cloudFront, {
        distributionId: 'E123ABC',
        paths: ['/*'],
        callerReference: expect.any(String),
      });
      const { callerReference } = jest.mocked(invalidateCloudFront).mock.calls[0][1];
      expect(JSON.parse(callerReference)).toEqual({
        pr: PHYSICAL_RESOURCE_ID,
        n: 'nonce-1',
        r: REQUEST_ID,
        lg: LOG_GROUP_NAME,
      });
      expect(jest.mocked(writeObject).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(invalidateCloudFront).mock.invocationCallOrder[0],
      );
      expect(response.Data).toMatchObject({ cacheInvalidated: 'true' });
    });

    it('builds the caller reference without a nonce when the resource has none', async () => {
      await requestHandler.handle(
        fakeCreateEvent({ sources: [], distributionId: 'E123ABC', invalidationPaths: ['/*'] }),
        LOG_GROUP_NAME,
      );

      const { callerReference } = jest.mocked(invalidateCloudFront).mock.calls[0][1];
      expect(JSON.parse(callerReference)).toMatchObject({ n: null });
    });

    it('invalidates without a target bucket when there are no sources to deploy', async () => {
      const response = await requestHandler.handle(
        fakeCreateEvent({ sources: [], distributionId: 'E123ABC', invalidationPaths: ['/*'] }),
        LOG_GROUP_NAME,
      );

      expect(writeObject).not.toHaveBeenCalled();
      expect(invalidateCloudFront).toHaveBeenCalledTimes(1);
      expect(response.PhysicalResourceId).toBe(PHYSICAL_RESOURCE_ID);
    });

    it('does nothing on Delete and keeps the physical id CloudFormation sent', async () => {
      const response = await requestHandler.handle(
        {
          ...fakeDeleteEvent({ targetBucket: 'my-bucket', sources: [dataSource(), zipSource()] }),
          PhysicalResourceId: 'physical-id-from-cloudformation',
        },
        LOG_GROUP_NAME,
      );

      expect(response).toEqual({
        PhysicalResourceId: 'physical-id-from-cloudformation',
        Data: { deleted: '0', objectsWritten: '0', cacheInvalidated: '0' },
      });
      expect(writeObject).not.toHaveBeenCalled();
      expect(deletePrefix).not.toHaveBeenCalled();
      expect(invalidateCloudFront).not.toHaveBeenCalled();
    });

    it.each([
      ['malformed sources', { targetBucket: 'my-bucket', sources: 'not-an-array' }],
      ['a targetBucket that is not a string', { targetBucket: 123, sources: [] }],
    ])('rejects %s as an expected failure', async (_case, properties) => {
      const failure = await rejectionOf(requestHandler.handle(fakeCreateEvent(properties), LOG_GROUP_NAME));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', expect.stringContaining('Invalid ResourceProperties'));
      expect(writeObject).not.toHaveBeenCalled();
    });

    it.each([
      ['no targetBucket', { sources: [dataSource()] }],
      ['a blank targetBucket', { targetBucket: '   ', sources: [dataSource()] }],
    ])('rejects sources with %s as an expected failure', async (_case, properties) => {
      const failure = await rejectionOf(requestHandler.handle(fakeCreateEvent(properties), LOG_GROUP_NAME));

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'Missing required property: targetBucket');
      expect(writeObject).not.toHaveBeenCalled();
    });

    it('lets a failing write through as an unexpected error', async () => {
      jest.mocked(writeObject).mockRejectedValue(new Error('AccessDenied'));

      const failure = await rejectionOf(
        requestHandler.handle(fakeCreateEvent({ targetBucket: 'my-bucket', sources: [dataSource()] }), LOG_GROUP_NAME),
      );

      expect(failure).not.toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty('message', 'AccessDenied');
    });
  });
});
