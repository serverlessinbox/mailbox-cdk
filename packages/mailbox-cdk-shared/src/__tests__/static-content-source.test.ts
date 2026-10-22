/// <reference types="jest" />

/**
 * Pins what each kind of static content source embeds in its custom resource and which S3 object ARNs
 * deploying it touches. The ARNs scope the deployer's IAM grants, so a prefix that loses its trailing slash
 * or a data source that gains a wildcard widens what the deployer may write.
 */

import { Bucket }              from 'aws-cdk-lib/aws-s3';
import { Stack }               from 'aws-cdk-lib';

import { StaticContentSource } from '../static-content-source';

describe('StaticContentSource', () => {
  const bucket = Bucket.fromBucketArn(new Stack(), 'target-bucket', 'arn:aws:s3:::target-bucket');

  describe('data', () => {
    it('embeds the key and body, with the write options when given', () => {
      const source = StaticContentSource.data('config/config.json', '{"a":1}', {
        contentType: 'application/json',
        cacheControl: 'no-store',
      });

      expect(source.spec).toEqual({
        kind: 'data',
        key: 'config/config.json',
        body: '{"a":1}',
        contentType: 'application/json',
        cacheControl: 'no-store',
      });
    });

    it('embeds no write options when none are given', () => {
      const source = StaticContentSource.data('config/config.json', '{"a":1}');

      expect(Object.keys(source.spec)).toEqual(['kind', 'key', 'body']);
    });

    it('touches exactly the object at its key, and reads no source', () => {
      const source = StaticContentSource.data('config/config.json', '{"a":1}');

      expect(source.objectArns(bucket)).toEqual(['arn:aws:s3:::target-bucket/config/config.json']);
      expect(source.sourceArns).toBeUndefined();
    });
  });

  describe('zipFromBucket', () => {
    it('embeds the source archive and its target prefix, with the source version when given', () => {
      const source = StaticContentSource.zipFromBucket('artifacts-bucket', 'ui/admin-ui.zip', 'content/', {
        sourceVersionId: 'v7',
      });

      expect(source.spec).toEqual({
        kind: 'zip',
        sourceBucket: 'artifacts-bucket',
        sourceKey: 'ui/admin-ui.zip',
        targetPrefix: 'content/',
        sourceVersionId: 'v7',
      });
    });

    it('embeds no source version when none is given', () => {
      const source = StaticContentSource.zipFromBucket('artifacts-bucket', 'ui/admin-ui.zip', 'content/');

      expect(Object.keys(source.spec)).not.toContain('sourceVersionId');
    });

    it.each([
      { name: 'without a trailing slash', targetPrefix: 'content', normalizedPrefix: 'content/' },
      { name: 'with a trailing slash', targetPrefix: 'content/', normalizedPrefix: 'content/' },
    ])('normalizes a target prefix $name', ({ targetPrefix, normalizedPrefix }) => {
      const source = StaticContentSource.zipFromBucket('artifacts-bucket', 'ui/admin-ui.zip', targetPrefix);

      expect(source.spec).toMatchObject({ targetPrefix: normalizedPrefix });
      expect(source.objectArns(bucket)).toEqual([`arn:aws:s3:::target-bucket/${normalizedPrefix}*`]);
    });

    it('reads exactly the source archive', () => {
      const source = StaticContentSource.zipFromBucket('artifacts-bucket', 'ui/admin-ui.zip', 'content/');

      expect(source.sourceArns?.()).toEqual(['arn:aws:s3:::artifacts-bucket/ui/admin-ui.zip']);
    });
  });
});
