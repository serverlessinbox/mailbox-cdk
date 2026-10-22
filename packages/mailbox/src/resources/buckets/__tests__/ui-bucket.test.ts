/// <reference types="jest" />

/**
 * UiBucket tests: the properties the class itself sets on the bucket it renders, the origins it
 * hands to a distribution, and the deploy grant it writes.
 */

import { Capture, Match, Template }          from 'aws-cdk-lib/assertions';
import { Distribution }                      from 'aws-cdk-lib/aws-cloudfront';
import { Role, ServicePrincipal }            from 'aws-cdk-lib/aws-iam';
import * as cdk                              from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }     from 'aws-cdk-lib';

import { UiBucket }                          from '../ui-bucket';

function newStack(): cdk.Stack {
  return new cdk.Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('UiBucket', () => {
  let template: Template;

  beforeEach(() => {
    const stack = newStack();
    new UiBucket(stack, 'ui-admin');
    template = Template.fromStack(stack);
  });

  it('blocks all public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls:       true,
        BlockPublicPolicy:     true,
        IgnorePublicAcls:      true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('enables ABAC', () => {
    template.hasResourceProperties('AWS::S3::Bucket', { AbacStatus: 'Enabled' });
  });

  it('deletes the bucket with the stack', () => {
    template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Delete', UpdateReplacePolicy: 'Delete' });
  });
});

describe('UiBucket origins', () => {
  let template: Template;

  beforeEach(() => {
    const stack        = newStack();
    const bucket       = new UiBucket(stack, 'ui-admin');
    const distribution = new Distribution(stack, 'distribution', {
      defaultBehavior: { origin: bucket.contentOrigin() },
    });
    distribution.addBehavior('/config/*', bucket.configOrigin());
    template = Template.fromStack(stack);
  });

  it('serves the content origin from /content and the config origin from the bucket root', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        Origins: [
          Match.objectLike({ OriginPath: '/content' }),
          Match.objectLike({ OriginPath: '' }),
        ],
      },
    });
  });

  it('reads the bucket through one Origin Access Control shared by both origins', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        Origins: [
          Match.objectLike({ OriginAccessControlId: { 'Fn::GetAtt': [Match.stringLikeRegexp('originaccesscontrol'), 'Id'] } }),
          Match.objectLike({ OriginAccessControlId: { 'Fn::GetAtt': [Match.stringLikeRegexp('originaccesscontrol'), 'Id'] } }),
        ],
      },
    });
  });

  it('names the Origin Access Control with the install id', () => {
    const name = new Capture();

    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({ Name: name }),
    });

    expect(JSON.stringify(name.asObject())).toContain('"Ref":"AWS::StackId"');
  });

  it('lets only the distribution it is bound to read the bucket objects, through the one bucket-policy statement', () => {
    const bucketId       = Object.keys(template.findResources('AWS::S3::Bucket'))[0];
    const distributionId = Object.keys(template.findResources('AWS::CloudFront::Distribution'))[0];

    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayEquals([
          Match.objectEquals({
            Action:    's3:GetObject',
            Effect:    'Allow',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Resource:  { 'Fn::Join': ['', [{ 'Fn::GetAtt': [bucketId, 'Arn'] }, '/*']] },
            Condition: {
              StringEquals: {
                'AWS:SourceArn': {
                  'Fn::Join': ['', [
                    'arn:', { Ref: 'AWS::Partition' }, ':cloudfront::', { Ref: 'AWS::AccountId' },
                    ':distribution/', { Ref: distributionId },
                  ]],
                },
              },
            },
          }),
        ]),
      },
    });
  });
});

describe('UiBucket.grantContentDeploy', () => {
  it('writes and deletes only under content/ and config/, and lists only those prefixes', () => {
    const stack        = newStack();
    const bucket       = new UiBucket(stack, 'ui-admin');
    const bucketArn    = { 'Fn::GetAtt': [Match.anyValue(), 'Arn'] };
    const objectsUnder = (prefix: string) => ({ 'Fn::Join': ['', [bucketArn, `/${prefix}/*`]] });
    const listUnder    = (prefix: string) => ({
      Action:    's3:ListBucket',
      Condition: { StringLike: { 's3:prefix': `${prefix}/*` } },
      Effect:    'Allow',
      Resource:  bucketArn,
    });

    bucket.grantContentDeploy(new Role(stack, 'deployer', { assumedBy: new ServicePrincipal('lambda.amazonaws.com') }));

    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          { Action: ['s3:PutObject', 's3:DeleteObject'], Effect: 'Allow', Resource: objectsUnder('content') },
          { Action: ['s3:PutObject', 's3:DeleteObject'], Effect: 'Allow', Resource: objectsUnder('config') },
          listUnder('content'),
          listUnder('config'),
        ],
      },
    });
  });
});
