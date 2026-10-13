/**
 * Pins which resource properties the bucket-auto-empty Lambda accepts. The Lambda rejects a request whose
 * `bucketName` is not a string, and must tolerate the extra keys CloudFormation adds, such as `ServiceToken`.
 */

import { isBucketAutoEmptyResourceProperties } from '../resource-properties';

describe('isBucketAutoEmptyResourceProperties', () => {
  it('accepts a bucketName string', () => {
    expect(isBucketAutoEmptyResourceProperties({ bucketName: 'my-bucket' })).toBe(true);
  });

  it('accepts properties without a bucketName', () => {
    expect(isBucketAutoEmptyResourceProperties({})).toBe(true);
  });

  it('accepts the extra keys CloudFormation adds', () => {
    expect(isBucketAutoEmptyResourceProperties({ bucketName: 'my-bucket', ServiceToken: 'arn:aws:lambda:x' })).toBe(true);
  });

  it('rejects a bucketName that is not a string', () => {
    expect(isBucketAutoEmptyResourceProperties({ bucketName: 123 })).toBe(false);
  });
});
