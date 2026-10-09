/// <reference types="jest" />

/**
 * Tests for resolveStaleTarget's use of the registry S3 client it is given. The release pointer must be
 * read through that injected client; a client built inside the function would escape the entry
 * point's single redirect-following client and be rebuilt on every call.
 */

import { S3Client } from '@aws-sdk/client-s3';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { resolveStaleTarget } from '../staleness';

jest.mock('@serverlessinbox/artifact-registry', () => ({
  deriveTrack: jest.fn(),
  readReleasePointer: jest.fn(),
}), { virtual: true });

const { readReleasePointer, deriveTrack } = jest.requireMock('@serverlessinbox/artifact-registry') as {
  readReleasePointer: jest.Mock;
  deriveTrack: jest.Mock;
};

describe('resolveStaleTarget', () => {
  it('reads the release pointer through the S3 client it is given', async () => {
    const registryS3 = new S3Client({ region: 'eu-west-1' });
    deriveTrack.mockReturnValue('v1');
    readReleasePointer.mockResolvedValue({ version: '1.2.4' });

    const stale = await resolveStaleTarget(
      registryS3,
      'eu-west-1',
      'test-pkg',
      '1.2.3',
      new LoggerBuffer(),
      { distTag: 'latest', granularity: 'major', project: 'serverlessinbox', artifactBucketBase: 'mailbox-artifacts' },
    );

    expect(stale?.pointer.version).toBe('1.2.4');
    expect(readReleasePointer.mock.calls[0][0]).toBe(registryS3);
  });
});
