import { S3Client, ListObjectVersionsCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { emptyBucket } from '../bucket-empty';

const s3Mock = mockClient(S3Client);

describe('emptyBucket', () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  it('should return 0 when bucket is already empty', async () => {
    s3Mock.on(ListObjectVersionsCommand).resolves({
      Versions: [],
      DeleteMarkers: [],
      IsTruncated: false,
    });

    const deleted = await emptyBucket('empty-bucket');
    expect(deleted).toBe(0);
    expect(s3Mock.call(0).args[0].input.Bucket).toBe('empty-bucket');
  });

  it('should delete all versions in a single page', async () => {
    s3Mock.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { Key: 'file1.txt', VersionId: 'v1' },
        { Key: 'file2.txt', VersionId: 'v2' },
      ],
      DeleteMarkers: [],
      IsTruncated: false,
    });

    s3Mock.on(DeleteObjectsCommand).resolves({
      Deleted: [
        { Key: 'file1.txt', VersionId: 'v1' },
        { Key: 'file2.txt', VersionId: 'v2' },
      ],
    });

    const deleted = await emptyBucket('test-bucket');
    expect(deleted).toBe(2);

    // Verify ListObjectVersions was called
    const listCall = s3Mock.commandCalls(ListObjectVersionsCommand)[0];
    expect(listCall.args[0].input.Bucket).toBe('test-bucket');

    // Verify DeleteObjects was called with correct keys
    const deleteCall = s3Mock.commandCalls(DeleteObjectsCommand)[0];
    expect(deleteCall.args[0].input.Delete?.Objects).toEqual([
      { Key: 'file1.txt', VersionId: 'v1' },
      { Key: 'file2.txt', VersionId: 'v2' },
    ]);
  });

  it('should delete both versions and delete markers', async () => {
    s3Mock.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { Key: 'file1.txt', VersionId: 'v1' },
      ],
      DeleteMarkers: [
        { Key: 'deleted-file.txt', VersionId: 'dm1' },
      ],
      IsTruncated: false,
    });

    s3Mock.on(DeleteObjectsCommand).resolves({
      Deleted: [
        { Key: 'file1.txt', VersionId: 'v1' },
        { Key: 'deleted-file.txt', VersionId: 'dm1' },
      ],
    });

    const deleted = await emptyBucket('versioned-bucket');
    expect(deleted).toBe(2);

    const deleteCall = s3Mock.commandCalls(DeleteObjectsCommand)[0];
    expect(deleteCall.args[0].input.Delete?.Objects).toContainEqual({ Key: 'file1.txt', VersionId: 'v1' });
    expect(deleteCall.args[0].input.Delete?.Objects).toContainEqual({ Key: 'deleted-file.txt', VersionId: 'dm1' });
  });

  it('should handle pagination with NextKeyMarker and NextVersionIdMarker', async () => {
    const firstPageVersions = [
      { Key: 'file1.txt', VersionId: 'v1' },
      { Key: 'file2.txt', VersionId: 'v2' },
    ];
    const secondPageVersions = [
      { Key: 'file3.txt', VersionId: 'v3' },
    ];

    s3Mock
      .on(ListObjectVersionsCommand, { KeyMarker: undefined })
      .resolves({
        Versions: firstPageVersions,
        DeleteMarkers: [],
        IsTruncated: true,
        NextKeyMarker: 'file2.txt',
        NextVersionIdMarker: 'v2',
      })
      .on(ListObjectVersionsCommand, { KeyMarker: 'file2.txt', VersionIdMarker: 'v2' })
      .resolves({
        Versions: secondPageVersions,
        DeleteMarkers: [],
        IsTruncated: false,
      });

    s3Mock.on(DeleteObjectsCommand).resolves({
      Deleted: [],
    });

    const deleted = await emptyBucket('large-bucket');
    expect(deleted).toBe(3); // 2 from first page + 1 from second page

    // Verify ListObjectVersions was called twice
    const listCalls = s3Mock.commandCalls(ListObjectVersionsCommand);
    expect(listCalls).toHaveLength(2);
    expect(listCalls[0].args[0].input.KeyMarker).toBeUndefined();
    expect(listCalls[1].args[0].input.KeyMarker).toBe('file2.txt');
    expect(listCalls[1].args[0].input.VersionIdMarker).toBe('v2');

    // Verify DeleteObjects was called twice
    const deleteCalls = s3Mock.commandCalls(DeleteObjectsCommand);
    expect(deleteCalls).toHaveLength(2);
  });

  it('should batch delete in chunks of 1000', async () => {
    const versions = Array.from({ length: 2500 }, (_, i) => ({
      Key: `file${i}.txt`,
      VersionId: `v${i}`,
    }));

    s3Mock.on(ListObjectVersionsCommand).resolves({
      Versions: versions,
      DeleteMarkers: [],
      IsTruncated: false,
    });

    s3Mock.on(DeleteObjectsCommand).resolves({
      Deleted: [],
    });

    const deleted = await emptyBucket('huge-bucket');
    expect(deleted).toBe(2500);

    // Verify DeleteObjects was called 3 times (1000 + 1000 + 500)
    const deleteCalls = s3Mock.commandCalls(DeleteObjectsCommand);
    expect(deleteCalls).toHaveLength(3);
    expect(deleteCalls[0].args[0].input.Delete?.Objects).toHaveLength(1000);
    expect(deleteCalls[1].args[0].input.Delete?.Objects).toHaveLength(1000);
    expect(deleteCalls[2].args[0].input.Delete?.Objects).toHaveLength(500);
  });

  it('should skip entries with missing Key or VersionId', async () => {
    s3Mock.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { Key: 'file1.txt', VersionId: 'v1' },
        { Key: undefined, VersionId: 'v2' }, // missing Key
        { Key: 'file3.txt', VersionId: undefined }, // missing VersionId
      ],
      DeleteMarkers: [
        { Key: 'file4.txt', VersionId: 'dm1' },
      ],
      IsTruncated: false,
    });

    s3Mock.on(DeleteObjectsCommand).resolves({
      Deleted: [],
    });

    const deleted = await emptyBucket('partial-bucket');
    expect(deleted).toBe(2); // only file1.txt and file4.txt

    const deleteCall = s3Mock.commandCalls(DeleteObjectsCommand)[0];
    expect(deleteCall.args[0].input.Delete?.Objects).toContainEqual({ Key: 'file1.txt', VersionId: 'v1' });
    expect(deleteCall.args[0].input.Delete?.Objects).toContainEqual({ Key: 'file4.txt', VersionId: 'dm1' });
    expect(deleteCall.args[0].input.Delete?.Objects).toHaveLength(2);
  });
});
