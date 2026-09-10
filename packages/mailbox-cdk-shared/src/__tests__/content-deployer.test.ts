/// <reference types="jest" />

/**
 * StaticContentDeployer IAM Scoping Tests
 *
 * Verifies invalidate() scopes cloudfront:CreateInvalidation to the target distribution ARN
 * rather than granting it on '*'.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { PinnedResolver, CdkArtifactEngine, StaticContentDeployer } from '../index';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '../artifact-engine';

describe('StaticContentDeployer IAM scoping', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: ICdkArtifactEngine;

  beforeEach(() => {
    app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-cdk-shared': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    const packages: Record<string, ArtifactVersionsEntry> = {
      'mailbox-cdk-shared': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
    pinnedResolver.registerPackages(['mailbox-cdk-shared']);
    artifactResolver = new CdkArtifactEngine(stack, pinnedResolver);
  });

  it('scopes cloudfront:CreateInvalidation to the target distribution ARN', () => {
    const deployer = StaticContentDeployer.getOrCreate(stack, artifactResolver);
    deployer.invalidate(stack, 'test-invalidation', {
      distributionId: 'E1234567890ABC',
      paths: ['/*'],
    });

    const template = Template.fromStack(stack);
    // Aws.PARTITION/Aws.ACCOUNT_ID are CFN pseudo-parameters — CDK renders the concatenation as
    // an Fn::Join of literal segments and { Ref: 'AWS::Partition' | 'AWS::AccountId' }, not a
    // plain resolved string, even with a fixed-account test stack.
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cloudfront:CreateInvalidation',
            Resource: {
              'Fn::Join': [
                '',
                [
                  'arn:',
                  { Ref: 'AWS::Partition' },
                  ':cloudfront::',
                  { Ref: 'AWS::AccountId' },
                  ':distribution/E1234567890ABC',
                ],
              ],
            },
          }),
        ]),
      },
    });
  });

  it('does not grant cloudfront:CreateInvalidation on a wildcard resource', () => {
    const deployer = StaticContentDeployer.getOrCreate(stack, artifactResolver);
    deployer.invalidate(stack, 'test-invalidation', {
      distributionId: 'E1234567890ABC',
      paths: ['/*'],
    });

    const template = Template.fromStack(stack);
    const policies = template.findResources('AWS::IAM::Policy');
    for (const policy of Object.values(policies)) {
      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      for (const statement of statements) {
        const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
        if (actions.includes('cloudfront:CreateInvalidation')) {
          const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
          expect(resources).not.toContain('*');
        }
      }
    }
  });
});
