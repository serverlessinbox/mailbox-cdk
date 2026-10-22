/**
 * Pins how a bucket is emptied: every page of versions and delete markers is listed and deleted, in
 * batches of at most 1000 because S3 rejects larger DeleteObjects calls, so a bucket that is not
 * fully emptied cannot be deleted with its stack. The loop also stops while the invocation still has time
 * to answer: a loop that ran until Lambda killed it would leave CloudFormation without an answer.
 */

import { S3Client, ListObjectVersionsCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { mockClient }                                                from 'aws-sdk-client-mock';

import { ExpectedFailure }                                           from '../../../runtime/handler-kit/errors/expected-failure';
import { BucketEmptier }                                             from '../bucket-emptier';

const PLENTY_OF_TIME = { getRemainingTimeInMillis: () => 900_000 };

describe('BucketEmptier', () => {
  const s3Mock  = mockClient(S3Client);
  const emptier = new BucketEmptier(new S3Client({}));

  beforeEach(() => {
    s3Mock.reset();
    s3Mock.on(DeleteObjectsCommand).resolves({});
  });

  it('deletes nothing and sends no delete call when the bucket is empty', async () => {
    s3Mock.on(ListObjectVersionsCommand).resolves({ Versions: [], DeleteMarkers: [], IsTruncated: false });

    const deleted = await emptier.empty('empty-bucket', PLENTY_OF_TIME);

    expect(deleted).toBe(0);
    expect(s3Mock.commandCalls(ListObjectVersionsCommand)[0].args[0].input.Bucket).toBe('empty-bucket');
    expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
  });

  it('deletes versions and delete markers quietly from the named bucket', async () => {
    s3Mock.on(ListObjectVersionsCommand).resolves({
      Versions: [{ Key: 'file1.txt', VersionId: 'v1' }],
      DeleteMarkers: [{ Key: 'deleted-file.txt', VersionId: 'dm1' }],
      IsTruncated: false,
    });

    const deleted = await emptier.empty('versioned-bucket', PLENTY_OF_TIME);

    expect(deleted).toBe(2);
    expect(s3Mock.commandCalls(DeleteObjectsCommand)[0].args[0].input).toEqual({
      Bucket: 'versioned-bucket',
      Delete: {
        Objects: [
          { Key: 'file1.txt', VersionId: 'v1' },
          { Key: 'deleted-file.txt', VersionId: 'dm1' },
        ],
        Quiet: true,
      },
    });
  });

  it('skips entries that lack a Key or a VersionId', async () => {
    s3Mock.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { Key: 'file1.txt', VersionId: 'v1' },
        { Key: undefined, VersionId: 'v2' },
        { Key: 'file3.txt', VersionId: undefined },
      ],
      DeleteMarkers: [{ Key: 'file4.txt', VersionId: 'dm1' }],
      IsTruncated: false,
    });

    const deleted = await emptier.empty('partial-bucket', PLENTY_OF_TIME);

    expect(deleted).toBe(2);
    expect(s3Mock.commandCalls(DeleteObjectsCommand)[0].args[0].input.Delete?.Objects).toEqual([
      { Key: 'file1.txt', VersionId: 'v1' },
      { Key: 'file4.txt', VersionId: 'dm1' },
    ]);
  });

  it('continues from the markers of a truncated page', async () => {
    s3Mock
      .on(ListObjectVersionsCommand)
      .resolvesOnce({
        Versions: [{ Key: 'file1.txt', VersionId: 'v1' }, { Key: 'file2.txt', VersionId: 'v2' }],
        IsTruncated: true,
        NextKeyMarker: 'file2.txt',
        NextVersionIdMarker: 'v2',
      })
      .resolvesOnce({ Versions: [{ Key: 'file3.txt', VersionId: 'v3' }], IsTruncated: false });

    const deleted = await emptier.empty('large-bucket', PLENTY_OF_TIME);

    expect(deleted).toBe(3);
    const listInputs = s3Mock.commandCalls(ListObjectVersionsCommand).map((call) => call.args[0].input);
    expect(listInputs).toEqual([
      { Bucket: 'large-bucket', KeyMarker: undefined, VersionIdMarker: undefined },
      { Bucket: 'large-bucket', KeyMarker: 'file2.txt', VersionIdMarker: 'v2' },
    ]);
    expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(2);
  });

  it('stops after a truncated page that names no next key', async () => {
    s3Mock
      .on(ListObjectVersionsCommand)
      .resolvesOnce({ Versions: [{ Key: 'file1.txt', VersionId: 'v1' }], IsTruncated: true })
      .resolves({ Versions: [{ Key: 'unreachable.txt', VersionId: 'v9' }], IsTruncated: false });

    const deleted = await emptier.empty('odd-bucket', PLENTY_OF_TIME);

    expect(deleted).toBe(1);
    expect(s3Mock.commandCalls(ListObjectVersionsCommand)).toHaveLength(1);
  });

  it('deletes in batches of 1000', async () => {
    const versions = Array.from(Array(2500).keys(), (i) => ({ Key: `file${i}.txt`, VersionId: `v${i}` }));
    s3Mock.on(ListObjectVersionsCommand).resolves({ Versions: versions, IsTruncated: false });

    const deleted = await emptier.empty('huge-bucket', PLENTY_OF_TIME);

    expect(deleted).toBe(2500);
    const batchSizes = s3Mock
      .commandCalls(DeleteObjectsCommand)
      .map((call) => call.args[0].input.Delete?.Objects?.length);
    expect(batchSizes).toEqual([1000, 1000, 500]);
  });

  describe('when S3 reports versions it did not delete', () => {
    const TWO_VERSIONS  = {
      Versions: [
        { Key: 'file1.txt', VersionId: 'v1' },
        { Key: 'file2.txt', VersionId: 'v2' },
      ],
      IsTruncated: false,
    };
    const REFUSED_FILE2 = { Errors: [{ Key: 'file2.txt', VersionId: 'v2', Code: 'InternalError' }] };

    it('retries only the refused versions and counts them as deleted once they go', async () => {
      s3Mock.on(ListObjectVersionsCommand).resolves(TWO_VERSIONS);
      s3Mock.on(DeleteObjectsCommand).resolvesOnce(REFUSED_FILE2).resolves({});

      const deleted = await emptier.empty('flaky-bucket', PLENTY_OF_TIME);

      expect(deleted).toBe(2);
      const deleteCalls = s3Mock.commandCalls(DeleteObjectsCommand);
      expect(deleteCalls.map((call) => call.args[0].input.Delete?.Objects)).toEqual([
        [
          { Key: 'file1.txt', VersionId: 'v1' },
          { Key: 'file2.txt', VersionId: 'v2' },
        ],
        [{ Key: 'file2.txt', VersionId: 'v2' }],
      ]);
    });

    it('fails with an ExpectedFailure naming the bucket and the count when S3 keeps refusing them', async () => {
      s3Mock.on(ListObjectVersionsCommand).resolves(TWO_VERSIONS);
      s3Mock.on(DeleteObjectsCommand).resolves(REFUSED_FILE2);

      const failure: unknown = await emptier.empty('stuck-bucket', PLENTY_OF_TIME).catch((thrown: unknown) => thrown);

      expect(failure).toBeInstanceOf(ExpectedFailure);
      expect(failure).toHaveProperty(
        'message',
        'Bucket stuck-bucket could not be emptied: 1 object versions were still not deleted after 3 attempts',
      );
      expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(3);
    });

    it('fails without retrying when the invocation is nearly out of time', async () => {
      s3Mock.on(ListObjectVersionsCommand).resolves(TWO_VERSIONS);
      s3Mock.on(DeleteObjectsCommand).resolves(REFUSED_FILE2);
      const remainingTime = jest.fn<number, []>().mockReturnValueOnce(900_000).mockReturnValue(30_000);

      const failure: unknown = await emptier
        .empty('slow-bucket', { getRemainingTimeInMillis: remainingTime })
        .catch((thrown: unknown) => thrown);

      expect(failure).toHaveProperty(
        'message',
        'Bucket slow-bucket could not be emptied: 1 object versions were still not deleted after 1 attempts',
      );
      expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(1);
    });
  });

  it('stops with an ExpectedFailure naming what it deleted before listing the next page when the invocation is nearly out of time', async () => {
    s3Mock
      .on(ListObjectVersionsCommand)
      .resolvesOnce({
        Versions: [{ Key: 'file1.txt', VersionId: 'v1' }],
        IsTruncated: true,
        NextKeyMarker: 'file1.txt',
        NextVersionIdMarker: 'v1',
      })
      .resolves({ Versions: [{ Key: 'file2.txt', VersionId: 'v2' }], IsTruncated: false });
    const remainingTime = jest.fn<number, []>().mockReturnValueOnce(900_000).mockReturnValue(30_000);

    const failure: unknown = await emptier
      .empty('slow-bucket', { getRemainingTimeInMillis: remainingTime })
      .catch((thrown: unknown) => thrown);

    expect(failure).toBeInstanceOf(ExpectedFailure);
    expect(failure).toHaveProperty(
      'message',
      'Bucket slow-bucket was not fully emptied before the Lambda deadline (1 items deleted so far); retry the delete to continue emptying it',
    );
    expect(s3Mock.commandCalls(ListObjectVersionsCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(1);
  });
});
