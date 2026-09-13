/// <reference types="jest" />
/// <reference types="node" />

/**
 * Unit tests for deployZipToPrefix.
 *
 * Tests the buffered zip approach (unzipper.Open.buffer) by mocking S3 client
 * and unzipper.Open.buffer to verify:
 * - Correct entries are uploaded with proper keys/content-types
 * - Directory entries are skipped
 * - Empty body throws cleanly
 * - uploaded count is accurate
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { deployZipToPrefix } from '../content-ops';

// Mock unzipper.Open.buffer to return test directory structure
jest.mock('unzipper', () => ({
  Open: {
    buffer: jest.fn(),
  },
}));

// Mock content-type and path utilities
jest.mock('../ui-content-type', () => ({
  guessContentType: jest.fn((key: string) => {
    if (key.endsWith('.html')) return 'text/html';
    if (key.endsWith('.js')) return 'application/javascript';
    if (key.endsWith('.css')) return 'text/css';
    if (key.endsWith('.json')) return 'application/json';
    return 'application/octet-stream';
  }),
}));

jest.mock('../ui-paths', () => ({
  normalizeRelativeKey: jest.fn((path: string) => {
    // Strip leading ./ or similar
    return path.replace(/^\.\//, '');
  }),
  normalizePrefix: jest.fn((prefix: string) => prefix),
}));


// Import the mock after defining it
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
          path: 'index.html',
          type: 'File',
          buffer: jest.fn().mockResolvedValue(Buffer.from('<html>test</html>')),
        },
        {
          path: 'app.js',
          type: 'File',
          buffer: jest.fn().mockResolvedValue(Buffer.from('console.log("test");')),
        },
        {
          path: 'style.css',
          type: 'File',
          buffer: jest.fn().mockResolvedValue(Buffer.from('body { color: red; }')),
        },
        {
          path: 'config.json',
          type: 'File',
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
    const result = await deployZipToPrefix(s3Client, {
      sourceBucket: 'source-bucket',
      sourceKey: 'ui.zip',
      targetBucket: 'target-bucket',
      targetPrefix: 'v1/',
    });

    expect(result.uploaded).toBe(4);

    // Verify GetObjectCommand was called
    const getCalls = s3Mock.commandCalls(GetObjectCommand);
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0].args[0].input).toEqual({
      Bucket: 'source-bucket',
      Key: 'ui.zip',
      VersionId: undefined,
    });

    // Verify PutObjectCommand was called for each file with correct keys
    const putCalls = s3Mock.commandCalls(PutObjectCommand);
    expect(putCalls).toHaveLength(4);

    // Check specific keys and content-types
    const putInputs = putCalls.map((call) => call.args[0].input);
    expect(putInputs).toContainEqual(
      expect.objectContaining({
        Bucket: 'target-bucket',
        Key: 'v1/index.html',
        ContentType: 'text/html',
      }),
    );
    expect(putInputs).toContainEqual(
      expect.objectContaining({
        Bucket: 'target-bucket',
        Key: 'v1/app.js',
        ContentType: 'application/javascript',
      }),
    );
    expect(putInputs).toContainEqual(
      expect.objectContaining({
        Bucket: 'target-bucket',
        Key: 'v1/style.css',
        ContentType: 'text/css',
      }),
    );
    expect(putInputs).toContainEqual(
      expect.objectContaining({
        Bucket: 'target-bucket',
        Key: 'v1/config.json',
        ContentType: 'application/json',
      }),
    );
  });

  it('skips directory entries', async () => {
    const mockDirectory = {
      files: [
        {
          path: 'dir/',
          type: 'Directory',
          buffer: jest.fn(),
        },
        {
          path: 'file.txt',
          type: 'File',
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
    const result = await deployZipToPrefix(s3Client, {
      sourceBucket: 'source-bucket',
      sourceKey: 'ui.zip',
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
          path: 'file.txt',
          type: 'File',
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
      sourceBucket: 'source-bucket',
      sourceKey: 'ui.zip',
      sourceVersionId: 'v123',
      targetBucket: 'target-bucket',
      targetPrefix: 'v1/',
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
        sourceKey: 'ui.zip',
        targetBucket: 'target-bucket',
        targetPrefix: 'v1/',
      }),
    ).rejects.toThrow('S3 GetObject returned empty body');
  });

  it('includes ContentLength in PutObject commands', async () => {
    const mockDirectory = {
      files: [
        {
          path: 'file.txt',
          type: 'File',
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
      sourceKey: 'ui.zip',
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
          path: 'test.txt',
          type: 'File',
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
      sourceKey: 'ui.zip',
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
