/**
 * Pins how a bucket is emptied: every page of versions and delete markers is listed and deleted, in
 * batches of at most 1000 because S3 rejects larger DeleteObjects calls, so a bucket that is not
 * fully emptied cannot be deleted with its stack.
 */

import { S3Client, ListObjectVersionsCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { BucketEmptier } from '../bucket-emptier';

describe('BucketEmptier', () => {
  const s3Mock = mockClient(S3Client);
  const emptier = new BucketEmptier(new S3Client({}));

  beforeEach(() => {
    s3Mock.reset();
    s3Mock.on(DeleteObjectsCommand).resolves({});
  });

  it('deletes nothing and sends no delete call when the bucket is empty', async () => {
    s3Mock.on(ListObjectVersionsCommand).resolves({ Versions: [], DeleteMarkers: [], IsTruncated: false });

    const deleted = await emptier.empty('empty-bucket');

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

    const deleted = await emptier.empty('versioned-bucket');

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

    const deleted = await emptier.empty('partial-bucket');

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

    const deleted = await emptier.empty('large-bucket');

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

    const deleted = await emptier.empty('odd-bucket');

    expect(deleted).toBe(1);
    expect(s3Mock.commandCalls(ListObjectVersionsCommand)).toHaveLength(1);
  });

  it('deletes in batches of 1000', async () => {
    const versions = Array.from({ length: 2500 }, (_, i) => ({ Key: `file${i}.txt`, VersionId: `v${i}` }));
    s3Mock.on(ListObjectVersionsCommand).resolves({ Versions: versions, IsTruncated: false });

    const deleted = await emptier.empty('huge-bucket');

    expect(deleted).toBe(2500);
    const batchSizes = s3Mock
      .commandCalls(DeleteObjectsCommand)
      .map((call) => call.args[0].input.Delete?.Objects?.length);
    expect(batchSizes).toEqual([1000, 1000, 500]);
  });
});
