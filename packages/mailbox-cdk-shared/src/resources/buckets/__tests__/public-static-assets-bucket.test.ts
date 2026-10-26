/**
 * PublicStaticAssetsBucket tests.
 *
 * Pins the one-bucket-per-stack accessor and what it creates: the public-read policy limited to object
 * reads, the ACL-only public access block, a destroyable bucket and its auto-empty custom resource. A
 * regression publishes more than object reads, creates a second bucket per call, or leaves a bucket
 * that blocks stack deletion.
 */

import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { Match, Template }                      from 'aws-cdk-lib/assertions';
import { App, Stack }                           from 'aws-cdk-lib';

import { KIT_ARTIFACT_PACKAGE }                 from '../../../artifacts/kit-artifact-package';
import { PublicStaticAssetsBucket }             from '../public-static-assets-bucket';

const fakeResolver = new PinnedArtifactResolver({
  packages:         { [KIT_ARTIFACT_PACKAGE]: { version: '1.0.0', zone: ArtifactZone.REGIONAL } },
  location:         { bucketBase: 'artifacts', project: 'serverlessinbox' },
  deploymentRegion: 'eu-west-1',
});

function newStack(): Stack {
  return new Stack(new App(), 'test-stack', { env: { account: '111122223333', region: 'eu-west-1' } });
}

function onlyBucketLogicalId(stack: Stack): string {
  const bucketIds = Object.keys(Template.fromStack(stack).findResources('AWS::S3::Bucket'));
  expect(bucketIds).toHaveLength(1);
  return bucketIds[0];
}

describe('PublicStaticAssetsBucket.getOrCreate', () => {
  it('returns the same bucket on every call and creates one bucket per stack', () => {
    const stack = newStack();

    const first  = PublicStaticAssetsBucket.getOrCreate(stack, fakeResolver);
    const second = PublicStaticAssetsBucket.getOrCreate(stack, fakeResolver);

    expect(second).toBe(first);
    Template.fromStack(stack).resourceCountIs('AWS::S3::Bucket', 1);
  });

  it('allows anyone to read objects and nothing else', () => {
    const stack = newStack();
    PublicStaticAssetsBucket.getOrCreate(stack, fakeResolver);

    const bucketId = onlyBucketLogicalId(stack);
    Template.fromStack(stack).hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: [
          {
            Action:    's3:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
            Effect:    'Deny',
            Principal: { AWS: '*' },
            Resource:  [
              { 'Fn::GetAtt': [bucketId, 'Arn'] },
              { 'Fn::Join': ['', [{ 'Fn::GetAtt': [bucketId, 'Arn'] }, '/*']] },
            ],
          },
          {
            Action:    's3:GetObject',
            Effect:    'Allow',
            Principal: { AWS: '*' },
            Resource:  { 'Fn::Join': ['', [{ 'Fn::GetAtt': [bucketId, 'Arn'] }, '/*']] },
          },
        ],
      },
    });
  });

  it('blocks only ACL-based public access and deletes the bucket with the stack', () => {
    const stack = newStack();

    PublicStaticAssetsBucket.getOrCreate(stack, fakeResolver);

    Template.fromStack(stack).hasResource('AWS::S3::Bucket', {
      Properties:     {
        PublicAccessBlockConfiguration: Match.objectEquals({
          BlockPublicAcls:       true,
          BlockPublicPolicy:     false,
          IgnorePublicAcls:      true,
          RestrictPublicBuckets: false,
        }),
      },
      DeletionPolicy: 'Delete',
    });
  });

  it('empties the bucket on stack deletion through a BucketAutoEmpty custom resource', () => {
    const stack = newStack();
    PublicStaticAssetsBucket.getOrCreate(stack, fakeResolver);

    Template.fromStack(stack).hasResourceProperties('Custom::BucketAutoEmpty', {
      bucketName: Match.objectLike({ Ref: onlyBucketLogicalId(stack) }),
    });
  });
});
