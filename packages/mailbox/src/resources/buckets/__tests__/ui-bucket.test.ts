/// <reference types="jest" />

/**
 * UiBucket tests: the properties the class itself sets on the bucket it renders.
 */

import { Match, Template }               from 'aws-cdk-lib/assertions';
import { ArnPrincipal }                  from 'aws-cdk-lib/aws-iam';
import * as cdk                          from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';

import { UiBucket }                      from '../ui-bucket';

describe('UiBucket', () => {
  let template: Template;

  beforeEach(() => {
    const stack = new cdk.Stack(new App(), 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    new UiBucket(stack, 'ui-admin');
    template = Template.fromStack(stack);
  });

  it('blocks all public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
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

  it('grantObjectReadTo allows only s3:GetObject on the bucket objects to the given principal', () => {
    const stack  = new cdk.Stack(new App(), 'GrantStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const bucket = new UiBucket(stack, 'ui-admin');

    bucket.grantObjectReadTo(new ArnPrincipal('arn:aws:iam::123456789012:user/oai-reader'));

    Template.fromStack(stack).hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: [
          {
            Action: 's3:GetObject',
            Effect: 'Allow',
            Principal: { AWS: 'arn:aws:iam::123456789012:user/oai-reader' },
            Resource: { 'Fn::Join': ['', [{ 'Fn::GetAtt': [Match.anyValue(), 'Arn'] }, '/*']] },
          },
        ],
      },
    });
  });
});
