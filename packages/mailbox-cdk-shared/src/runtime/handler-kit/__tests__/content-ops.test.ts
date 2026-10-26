/// <reference types="jest" />
/// <reference types="node" />

/**
 * Pins the S3 content operations the content deployers share: a zip is unpacked entry by entry under a
 * prefix with the key and content type each entry is given, a prefix is emptied page by page in batches S3
 * accepts, and one object is written with its headers. A regression here corrupts a deployed UI bucket or
 * leaves stale objects behind. The key an entry is written under and the content type it is given are steps of
 * deployZipToPrefix and are pinned through it: a path that leaves the prefix would write outside the directory
 * a deployment owns, and text without its charset would be decoded with the browser's default.
 */

import {
  S3Client,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type _Object,
} from '@aws-sdk/client-s3';
import { mockClient }                                   from 'aws-sdk-client-mock';
import { Readable }                                     from 'stream';

import { deletePrefix, deployZipToPrefix, writeObject } from '../content-ops';

/** The part of an unzipper entry that `deployZipToPrefix` reads. */
interface FakeZipEntry {
  readonly path: string;
  readonly type: 'File' | 'Directory';
  buffer(): Promise<Buffer>;
}

/** The part of an unzipper central directory that `deployZipToPrefix` reads. */
interface FakeZipDirectory {
  readonly files: FakeZipEntry[];
}

const mockOpenBuffer = jest.fn<Promise<FakeZipDirectory>, [Buffer]>();

jest.mock('unzipper', () => ({
  Open: {
    buffer: (zip: Buffer) => mockOpenBuffer(zip),
  },
}));

/** A file entry of a zip, with the content its `buffer()` yields. */
function fileEntry(path: string, content: string): FakeZipEntry {
  return { path, type: 'File', buffer: async () => Buffer.from(content) };
}

/** A directory entry of a zip, which carries no content. */
function directoryEntry(path: string): FakeZipEntry {
  return { path, type: 'Directory', buffer: async () => Buffer.alloc(0) };
}

/** The streaming body S3 answers a GetObject with; the unit reads only its bytes. */
function zipBody() {
  return Object.assign(Readable.from(Buffer.from('mock-zip-data')), {
    transformToByteArray: async () => new Uint8Array(Buffer.from('mock-zip-data')),
    transformToString:    async () => 'mock-zip-data',
    transformToWebStream: () => new ReadableStream(),
  });
}

describe('deployZipToPrefix', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    jest.clearAllMocks();
    s3Mock.reset();
  });

  it('deploys zip entries to S3 with correct keys and content-types', async () => {
    mockOpenBuffer.mockResolvedValue({
      files: [
        fileEntry('./index.html', '<html>test</html>'),
        fileEntry('app.js', 'console.log("test");'),
        fileEntry('style.css', 'body { color: red; }'),
        fileEntry('config.json', '{"key":"value"}'),
      ],
    });
    s3Mock.on(GetObjectCommand).resolves({ Body: zipBody() });
    s3Mock.on(PutObjectCommand).resolves({});

    const s3Client = new S3Client({});
    const result   = await deployZipToPrefix(s3Client, {
      sourceBucket: 'source-bucket',
      sourceKey:    'ui.zip',
      targetBucket: 'target-bucket',
      targetPrefix: 'v1/',
    });

    expect(result.uploaded).toBe(4);

    // Verify GetObjectCommand was called
    const getCalls = s3Mock.commandCalls(GetObjectCommand);
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0].args[0].input).toEqual({
      Bucket:    'source-bucket',
      Key:       'ui.zip',
      VersionId: undefined,
    });

    // Verify PutObjectCommand was called for each file with correct keys
    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    expect(putCalls).toHaveLength(4);

    const putInputs = putCalls.map((call) => call.args[0].input);
    expect(putInputs.map((input) => input.Bucket)).toEqual(['target-bucket', 'target-bucket', 'target-bucket', 'target-bucket']);
    expect(putInputs.map((input) => input.Key)).toEqual(['v1/index.html', 'v1/app.js', 'v1/style.css', 'v1/config.json']);
  });

  it('skips directory entries', async () => {
    mockOpenBuffer.mockResolvedValue({ files: [directoryEntry('dir/'), fileEntry('file.txt', 'content')] });
    s3Mock.on(GetObjectCommand).resolves({ Body: zipBody() });
    s3Mock.on(PutObjectCommand).resolves({});

    const s3Client = new S3Client({});
    const result   = await deployZipToPrefix(s3Client, {
      sourceBucket: 'source-bucket',
      sourceKey:    'ui.zip',
      targetBucket: 'target-bucket',
      targetPrefix: 'v1/',
    });

    // Only 1 file, directory should be skipped
    expect(result.uploaded).toBe(1);

    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    expect(putCalls).toHaveLength(1);
  });

  it('uses sourceVersionId when provided', async () => {
    mockOpenBuffer.mockResolvedValue({ files: [fileEntry('file.txt', 'content')] });
    s3Mock.on(GetObjectCommand).resolves({ Body: zipBody() });
    s3Mock.on(PutObjectCommand).resolves({});

    const s3Client = new S3Client({});
    await deployZipToPrefix(s3Client, {
      sourceBucket:    'source-bucket',
      sourceKey:       'ui.zip',
      sourceVersionId: 'v123',
      targetBucket:    'target-bucket',
      targetPrefix:    'v1/',
    });

    const getCalls = s3Mock.commandCalls(GetObjectCommand);
    expect(getCalls[0].args[0].input.VersionId).toBe('v123');
  });

  it('throws cleanly when S3 returns empty body', async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: undefined });

    const s3Client = new S3Client({});
    await expect(
      deployZipToPrefix(s3Client, {
        sourceBucket: 'source-bucket',
        sourceKey:    'ui.zip',
        targetBucket: 'target-bucket',
        targetPrefix: 'v1/',
      }),
    ).rejects.toThrow('S3 GetObject returned empty body');
  });

  it('includes ContentLength in PutObject commands', async () => {
    mockOpenBuffer.mockResolvedValue({ files: [fileEntry('file.txt', 'test content here')] });
    s3Mock.on(GetObjectCommand).resolves({ Body: zipBody() });
    s3Mock.on(PutObjectCommand).resolves({});

    const s3Client = new S3Client({});
    await deployZipToPrefix(s3Client, {
      sourceBucket: 'source-bucket',
      sourceKey:    'ui.zip',
      targetBucket: 'target-bucket',
      targetPrefix: 'v1/',
    });

    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    const putInput = putCalls[0].args[0].input;

    // ContentLength should be set and should match Body length
    expect(Buffer.isBuffer(putInput.Body)).toBe(true);
    expect(putInput.ContentLength).toBe(Buffer.byteLength('test content here'));
  });

  it('accepts injected S3Client and uses it for all calls', async () => {
    mockOpenBuffer.mockResolvedValue({ files: [fileEntry('test.txt', 'test')] });
    const injectedClient = new S3Client({});
    const injectedMock   = mockClient(injectedClient);
    injectedMock.on(GetObjectCommand).resolves({ Body: zipBody() });
    injectedMock.on(PutObjectCommand).resolves({});

    await deployZipToPrefix(injectedClient, {
      sourceBucket: 'source-bucket',
      sourceKey:    'ui.zip',
      targetBucket: 'target-bucket',
      targetPrefix: 'v1/',
    });

    expect(injectedMock.commandCalls(GetObjectCommand)).toHaveLength(1);
    expect(injectedMock.commandCalls(PutObjectCommand)).toHaveLength(1);
    expect(s3Mock.calls()).toHaveLength(0);
  });
});

describe('deletePrefix', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
    s3Mock.on(DeleteObjectsCommand).resolves({});
  });

  function keysNamed(count: number, from = 0): _Object[] {
    return Array.from({ length: count }, (_element, index) => ({ Key: `content/file-${from + index}` }));
  }

  it('deletes nothing and returns 0 when the prefix holds no objects', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({});

    const deleted = await deletePrefix(new S3Client({}), 'target-bucket', 'content/');

    expect(deleted).toBe(0);
    expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
  });

  it('stops at a page without keys even when S3 offers a continuation token', async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [], NextContinuationToken: 'never-followed' })
      .resolves({ Contents: keysNamed(1) });

    const deleted = await deletePrefix(new S3Client({}), 'target-bucket', 'content/');

    expect(deleted).toBe(0);
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(1);
  });

  it('skips a listed object that has no key', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [...keysNamed(1), { Size: 5 }] });

    const deleted = await deletePrefix(new S3Client({}), 'target-bucket', 'content/');

    expect(deleted).toBe(1);
    expect(s3Mock.commandCalls(DeleteObjectsCommand)[0].args[0].input.Delete?.Objects).toEqual(keysNamed(1));
  });

  it('lists the prefix in the bucket it is given and deletes the listed keys quietly', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: keysNamed(2) });

    const deleted = await deletePrefix(new S3Client({}), 'target-bucket', 'content/');

    expect(deleted).toBe(2);
    expect(s3Mock.commandCalls(ListObjectsV2Command)[0].args[0].input).toMatchObject({
      Bucket: 'target-bucket',
      Prefix: 'content/',
    });
    expect(s3Mock.commandCalls(DeleteObjectsCommand)[0].args[0].input).toEqual({
      Bucket: 'target-bucket',
      Delete: { Objects: keysNamed(2), Quiet: true },
    });
  });

  it('follows the continuation token to delete every page', async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: keysNamed(2), NextContinuationToken: 'page-2' })
      .resolvesOnce({ Contents: keysNamed(1, 2) });

    const deleted = await deletePrefix(new S3Client({}), 'target-bucket', 'content/');

    expect(deleted).toBe(3);
    const listCalls = s3Mock.commandCalls(ListObjectsV2Command);
    expect(listCalls[0].args[0].input.ContinuationToken).toBeUndefined();
    expect(listCalls[1].args[0].input.ContinuationToken).toBe('page-2');
    expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(2);
  });

  it('fails naming each key S3 reports as not deleted, instead of counting it deleted', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: keysNamed(2) });
    s3Mock.on(DeleteObjectsCommand).resolves({
      Errors: [{ Key: 'content/file-1', Code: 'AccessDenied', Message: 'Access Denied' }],
    });

    await expect(deletePrefix(new S3Client({}), 'target-bucket', 'content/')).rejects.toThrow(
      'Failed to delete 1 object(s) in target-bucket: content/file-1 (AccessDenied)',
    );
  });

  it('deletes a page of more than 1000 keys in batches of at most 1000', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: keysNamed(1001) });

    const deleted = await deletePrefix(new S3Client({}), 'target-bucket', 'content/');

    expect(deleted).toBe(1001);
    const batchSizes = s3Mock
      .commandCalls(DeleteObjectsCommand)
      .map((call) => call.args[0].input.Delete?.Objects?.length);
    expect(batchSizes).toEqual([1000, 1]);
  });
});

describe('writeObject', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
  });

  it('writes the body under the key in the target bucket with its content type and cache control', async () => {
    await writeObject(new S3Client({}), {
      targetBucket: 'target-bucket',
      key:          'config.json',
      body:         '{"a":1}',
      contentType:  'application/json',
      cacheControl: 'no-store',
    });

    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toEqual({
      Bucket:       'target-bucket',
      Key:          'config.json',
      Body:         '{"a":1}',
      ContentType:  'application/json',
      CacheControl: 'no-store',
    });
  });
});

describe('deployZipToPrefix, for one entry', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    jest.clearAllMocks();
    s3Mock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
  });

  async function deployEntry(entryPath: string): Promise<void> {
    mockOpenBuffer.mockResolvedValue({ files: [fileEntry(entryPath, 'content')] });
    s3Mock.on(GetObjectCommand).resolves({ Body: zipBody() });

    await deployZipToPrefix(new S3Client({}), {
      sourceBucket: 'source-bucket',
      sourceKey:    'ui.zip',
      targetBucket: 'target-bucket',
      targetPrefix: 'v1/',
    });
  }

  function writtenInput() {
    return s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
  }

  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['style.css', 'text/css; charset=utf-8'],
    ['app.js', 'application/javascript; charset=utf-8'],
    ['config.json', 'application/json; charset=utf-8'],
    ['logo.png', 'image/png'],
    ['data.unknownextension', undefined],
  ])('stores %s with the content type %s', async (entryPath, contentType) => {
    await deployEntry(entryPath);

    expect(writtenInput().ContentType).toBe(contentType);
  });

  it.each([
    ['index.html', 'v1/index.html'],
    ['  assets/app.js  ', 'v1/assets/app.js'],
    ['///assets/app.js', 'v1/assets/app.js'],
    ['assets/./img/../app.js', 'v1/assets/app.js'],
  ])('writes the entry path %j under the key %j', async (entryPath, key) => {
    await deployEntry(entryPath);

    expect(writtenInput().Key).toBe(key);
  });

  it.each([
    ['an empty path', ''],
    ['a blank path', '   '],
    ['only slashes', '///'],
    ['the current directory', '.'],
    ['a path that leaves the prefix', '../outside.txt'],
    ['a path that climbs out after descending', 'assets/../../outside.txt'],
    ['a Windows drive path', 'C:/windows/file.txt'],
  ])('refuses %s and writes nothing', async (_description, entryPath) => {
    await expect(deployEntry(entryPath)).rejects.toThrow(`Invalid relative key: ${entryPath}`);

    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});
