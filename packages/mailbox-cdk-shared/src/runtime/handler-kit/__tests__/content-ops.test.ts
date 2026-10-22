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

import { deletePrefix, deployZipToPrefix, writeObject } from '../content-ops';

jest.mock('unzipper', () => ({
  Open: {
    buffer: jest.fn(),
  },
}));

const unzipperMock = require('unzipper');

describe('deployZipToPrefix', () => {
  const s3Mock = mockClient(S3Client as any);

  beforeEach(() => {
    jest.clearAllMocks();
    s3Mock.reset();
  });

  it('deploys zip entries to S3 with correct keys and content-types', async () => {
    // Mock directory structure
    const mockDirectory = {
      files: [
        {
          path:   './index.html',
          type:   'File',
          buffer: jest.fn().mockResolvedValue(Buffer.from('<html>test</html>')),
        },
        {
          path:   'app.js',
          type:   'File',
          buffer: jest.fn().mockResolvedValue(Buffer.from('console.log("test");')),
        },
        {
          path:   'style.css',
          type:   'File',
          buffer: jest.fn().mockResolvedValue(Buffer.from('body { color: red; }')),
        },
        {
          path:   'config.json',
          type:   'File',
          buffer: jest.fn().mockResolvedValue(Buffer.from('{"key":"value"}')),
        },
      ],
    };

    unzipperMock.Open.buffer.mockResolvedValue(mockDirectory);
    const mockBody = {
      transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array(Buffer.from('mock-zip-data'))),
    };
    s3Mock.on(GetObjectCommand).resolves({ Body: mockBody as any });
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

    // Check specific keys and content-types
    const putInputs = putCalls.map((call) => call.args[0].input);
    expect(putInputs).toContainEqual(
      expect.objectContaining({
        Bucket:      'target-bucket',
        Key:         'v1/index.html',
        ContentType: 'text/html; charset=utf-8',
      }),
    );
    expect(putInputs).toContainEqual(
      expect.objectContaining({
        Bucket:      'target-bucket',
        Key:         'v1/app.js',
        ContentType: 'application/javascript; charset=utf-8',
      }),
    );
    expect(putInputs).toContainEqual(
      expect.objectContaining({
        Bucket:      'target-bucket',
        Key:         'v1/style.css',
        ContentType: 'text/css; charset=utf-8',
      }),
    );
    expect(putInputs).toContainEqual(
      expect.objectContaining({
        Bucket:      'target-bucket',
        Key:         'v1/config.json',
        ContentType: 'application/json; charset=utf-8',
      }),
    );
  });

  it('skips directory entries', async () => {
    const mockDirectory = {
      files: [
        {
          path:   'dir/',
          type:   'Directory',
          buffer: jest.fn(),
        },
        {
          path:   'file.txt',
          type:   'File',
          buffer: jest.fn().mockResolvedValue(Buffer.from('content')),
        },
      ],
    };

    unzipperMock.Open.buffer.mockResolvedValue(mockDirectory);
    const mockBody = {
      transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array(Buffer.from('mock-zip-data'))),
    };
    s3Mock.on(GetObjectCommand).resolves({ Body: mockBody as any });
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
    const mockDirectory = {
      files: [
        {
          path:   'file.txt',
          type:   'File',
          buffer: jest.fn().mockResolvedValue(Buffer.from('content')),
        },
      ],
    };

    unzipperMock.Open.buffer.mockResolvedValue(mockDirectory);
    const mockBody = {
      transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array(Buffer.from('mock-zip-data'))),
    };
    s3Mock.on(GetObjectCommand).resolves({ Body: mockBody as any });
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
    const mockDirectory = {
      files: [
        {
          path:   'file.txt',
          type:   'File',
          buffer: jest.fn().mockResolvedValue(Buffer.from('test content here')),
        },
      ],
    };

    unzipperMock.Open.buffer.mockResolvedValue(mockDirectory);
    const mockBody = {
      transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array(Buffer.from('mock-zip-data'))),
    };
    s3Mock.on(GetObjectCommand).resolves({ Body: mockBody as any });
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
    expect(putInput.ContentLength).toBeDefined();
    expect(putInput.ContentLength).toBeGreaterThan(0);
    if (Buffer.isBuffer(putInput.Body)) {
      expect(putInput.ContentLength).toBe(putInput.Body.length);
    }
  });

  it('accepts injected S3Client and uses it for all calls', async () => {
    const mockDirectory = {
      files: [
        {
          path:   'test.txt',
          type:   'File',
          buffer: jest.fn().mockResolvedValue(Buffer.from('test')),
        },
      ],
    };

    unzipperMock.Open.buffer.mockResolvedValue(mockDirectory);
    const mockBody = {
      transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array(Buffer.from('mock-zip-data'))),
    };
    s3Mock.on(GetObjectCommand).resolves({ Body: mockBody as any });
    s3Mock.on(PutObjectCommand).resolves({});

    // Create a fake S3 client with a jest mock send method
    const fakeS3 = {
      send: jest.fn(),
    };

    // Mock the send method to handle commands
    (fakeS3.send as jest.Mock).mockImplementation(async (command) => {
      if (command instanceof GetObjectCommand) {
        return { Body: mockBody };
      } else if (command instanceof PutObjectCommand) {
        return {};
      }
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    });

    await deployZipToPrefix(fakeS3 as any, {
      sourceBucket: 'source-bucket',
      sourceKey:    'ui.zip',
      targetBucket: 'target-bucket',
      targetPrefix: 'v1/',
    });

    // Verify the injected client's send method was called
    expect(fakeS3.send).toHaveBeenCalled();
    const calls = (fakeS3.send as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    // Verify we had at least one GetObjectCommand and at least one PutObjectCommand
    const getCommands = calls.filter((call) => call[0] instanceof GetObjectCommand);
    const putCommands = calls.filter((call) => call[0] instanceof PutObjectCommand);
    expect(getCommands.length).toBeGreaterThan(0);
    expect(putCommands.length).toBeGreaterThan(0);
  });
});

describe('deletePrefix', () => {
  const s3Mock = mockClient(S3Client);

  beforeEach(() => {
    s3Mock.reset();
    s3Mock.on(DeleteObjectsCommand).resolves({});
  });

  function keysNamed(count: number, from = 0): _Object[] {
    return Array.from({ length: count }, (_, index) => ({ Key: `content/file-${from + index}` }));
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
    unzipperMock.Open.buffer.mockResolvedValue({
      files: [{ path: entryPath, type: 'File', buffer: jest.fn().mockResolvedValue(Buffer.from('content')) }],
    });
    const body = { transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array()) };
    s3Mock.on(GetObjectCommand).resolves({ Body: body as any });

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
