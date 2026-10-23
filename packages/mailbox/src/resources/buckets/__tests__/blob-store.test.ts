/// <reference types="jest" />

/**
 * BlobStore: the data tier bucket. Development mode and the removal policy arrive as props, so these
 * cases pin what each setting does to the bucket: versioning and lifecycle, deletion with the stack,
 * and the account condition on the customer key's policy, which must stay a CloudFormation reference
 * because the data stack is synthesized with an explicit environment.
 */

import { Match, Template }                          from 'aws-cdk-lib/assertions';
import * as kms                                     from 'aws-cdk-lib/aws-kms';
import { App, RemovalPolicy, Stack }                from 'aws-cdk-lib';

import { BlobStore }                                from '../blob-store';

function createStack(): Stack {
  return new Stack(new App(), 'TestStack', { env: { account: '123456789012', region: 'us-west-2' } });
}

describe('BlobStore', () => {
  describe('in production mode', () => {
    const stack = createStack();
    new BlobStore(stack, { developmentMode: false, removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE });
    const template = Template.fromStack(stack);

    it('versions objects and expires noncurrent versions and delete markers besides the two prefix rules', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        VersioningConfiguration: { Status: 'Enabled' },
        LifecycleConfiguration:  {
          Rules: [
            Match.objectLike({ Id: 'DeleteUnhandledIncomingEmails', Prefix: 'incoming-emails/', ExpirationInDays: 7 }),
            Match.objectLike({ Id: 'DeleteUploadedBlobs', Prefix: 'uploads/', ExpirationInDays: 1 }),
            Match.objectLike({ Id: 'DeleteNoncurrentVersions', NoncurrentVersionExpiration: { NoncurrentDays: 35 } }),
            Match.objectLike({ Id: 'DeleteExpiredObjectDeleteMarkers', ExpiredObjectDeleteMarker: true }),
          ],
        },
      });
    });

    it('takes its deletion behaviour from the removal policy prop and does not delete objects with the stack', () => {
      template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'RetainExceptOnCreate', UpdateReplacePolicy: 'Retain' });
      template.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
    });
  });

  describe('in development mode', () => {
    const stack = createStack();
    new BlobStore(stack, { developmentMode: true, removalPolicy: RemovalPolicy.DESTROY });
    const template = Template.fromStack(stack);

    it('has no versioning, only the two prefix lifecycle rules, and deletes objects with the stack', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        VersioningConfiguration: Match.absent(),
        LifecycleConfiguration:  {
          Rules: [
            Match.objectLike({ Id: 'DeleteUnhandledIncomingEmails' }),
            Match.objectLike({ Id: 'DeleteUploadedBlobs' }),
          ],
        },
      });
      template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Delete' });
      template.resourceCountIs('Custom::S3AutoDeleteObjects', 1);
    });
  });

  describe('encryption', () => {
    it('uses S3-managed encryption without a customer key', () => {
      const stack = createStack();
      new BlobStore(stack, { developmentMode: true, removalPolicy: RemovalPolicy.DESTROY });

      Template.fromStack(stack).hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: { ServerSideEncryptionConfiguration: [Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } })] },
      });
    });

    it('uses SSE-KMS and lets S3 use the key, conditioned on the deploying account reference', () => {
      const stack         = createStack();
      const encryptionKey = new kms.Key(stack, 'key');
      new BlobStore(stack, { developmentMode: true, removalPolicy: RemovalPolicy.DESTROY, encryptionKey });

      // The key is created in the stack under test, so its policy and the bucket reference each other.
      const template = Template.fromStack(stack, { skipCyclicalDependenciesCheck: true });
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: { ServerSideEncryptionConfiguration: [Match.objectLike({ ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'aws:kms' }) })] },
      });
      template.hasResourceProperties('AWS::KMS::Key', {
        KeyPolicy: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: 's3.amazonaws.com' },
              Condition: { StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } }, ArnLike: Match.anyValue() },
            }),
          ]),
        },
      });
    });
  });

  describe('public access', () => {
    it('blocks every form of public access on the bucket', () => {
      const stack = createStack();
      new BlobStore(stack, { developmentMode: false, removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE });

      Template.fromStack(stack).hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls:       true,
          BlockPublicPolicy:     true,
          IgnorePublicAcls:      true,
          RestrictPublicBuckets: true,
        },
      });
    });
  });

  describe('bucket policy', () => {
    const stack = createStack();
    new BlobStore(stack, { developmentMode: true, removalPolicy: RemovalPolicy.DESTROY });
    const template = Template.fromStack(stack);

    it('lets SES write inbound mail under incoming-emails/ for this account only', () => {
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: 'ses.amazonaws.com' },
              Action:    's3:PutObject',
              Resource:  { 'Fn::Join': ['', [Match.anyValue(), '/incoming-emails/*']] },
              Condition: { StringEquals: { 'aws:Referer': { Ref: 'AWS::AccountId' } } },
            }),
          ]),
        },
      });
    });

    it('lets CloudFront of this account read tenants/ only', () => {
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: 'cloudfront.amazonaws.com' },
              Action:    's3:GetObject',
              Resource:  { 'Fn::Join': ['', [Match.anyValue(), '/tenants/*']] },
              Condition: { StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } } },
            }),
          ]),
        },
      });
    });
  });
});
