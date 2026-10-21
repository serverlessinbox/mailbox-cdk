/// <reference types="jest" />

/**
 * UiBucket tests: the properties the class itself sets on the bucket it renders.
 */

import { Template }                      from 'aws-cdk-lib/assertions';
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
});
