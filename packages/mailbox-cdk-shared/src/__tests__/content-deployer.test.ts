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
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { PinnedResolver, CdkArtifactEngine, StaticContentDeployer, StaticContentSource } from '../index';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import type { ICdkArtifactEngine } from '../artifact-engine';

/** Synthesizes a stack via `configure`, then returns the `Properties` of the single
 *  `Custom::ContentInvalidation` resource whose `distributionId` equals `distributionId`. Used to
 *  inspect the auto-derived `deploymentNonce` without depending on CDK's logical-ID naming. */
function synthInvalidationProperties(
  distributionId: string,
  configure: (deployer: StaticContentDeployer, stack: cdk.Stack) => void,
): Record<string, unknown> {
  const app = new App({
    context: {
      'serverlessinbox:artifacts': {
        bucketBase: 'test-artifacts',
        packages: {
          'mailbox-cdk-shared': { kind: 'release', version: '1.0.0' },
        },
      },
    },
  });
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const packages: Record<string, ArtifactVersionsEntry> = {
    'mailbox-cdk-shared': { version: '1.0.0', zone: 'regional' },
  };
  const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
  pinnedResolver.registerPackages(['mailbox-cdk-shared']);
  const artifactResolver: ICdkArtifactEngine = new CdkArtifactEngine(stack, pinnedResolver);

  const deployer = StaticContentDeployer.getOrCreate(stack, artifactResolver);
  configure(deployer, stack);

  const template = Template.fromStack(stack);
  const resources = template.findResources('Custom::ContentInvalidation');
  const matches = Object.values(resources).filter((r) => r.Properties?.distributionId === distributionId);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one Custom::ContentInvalidation resource for ${distributionId}, found ${matches.length}`);
  }
  return matches[0].Properties as Record<string, unknown>;
}

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

describe('StaticContentDeployer invalidate() auto-derived deploymentNonce', () => {
  // Regression coverage for the acc defect (2026-09-14): the invalidation CustomResource's
  // properties were caller-supplied and constant, so CloudFormation never re-invoked it on
  // redeploy and stale content stayed cached. These pin that the properties instead track the
  // content of the deployments they follow, deterministically.

  const deployUiBundle = (deployer: StaticContentDeployer, scope: cdk.Stack, id: string, sourceKey: string, sourceVersionId: string) => {
    const bucket = Bucket.fromBucketName(scope, 'target-bucket', 'ui-bucket');
    deployer.deploy(scope, id, {
      targetBucket: bucket,
      source: StaticContentSource.zipFromBucket('artifacts-bucket', sourceKey, 'content/', { sourceVersionId }),
    });
  };

  it('gives identical properties across two synths of identical inputs', () => {
    const build = () =>
      synthInvalidationProperties('E-IDENTICAL', (deployer, stack) => {
        deployUiBundle(deployer, stack, 'ui-content', 'admin-ui.zip', 'v1');
        deployer.invalidate(stack, 'ui-invalidate', { distributionId: 'E-IDENTICAL', paths: ['/*'] });
      });

    expect(build()).toEqual(build());
  });

  it('changes properties when the deployed bundle source key or version changes', () => {
    const before = synthInvalidationProperties('E-CHANGED', (deployer, stack) => {
      deployUiBundle(deployer, stack, 'ui-content', 'admin-ui.zip', 'v1');
      deployer.invalidate(stack, 'ui-invalidate', { distributionId: 'E-CHANGED', paths: ['/*'] });
    });

    const afterVersionBump = synthInvalidationProperties('E-CHANGED', (deployer, stack) => {
      deployUiBundle(deployer, stack, 'ui-content', 'admin-ui.zip', 'v2');
      deployer.invalidate(stack, 'ui-invalidate', { distributionId: 'E-CHANGED', paths: ['/*'] });
    });

    const afterKeyChange = synthInvalidationProperties('E-CHANGED', (deployer, stack) => {
      deployUiBundle(deployer, stack, 'ui-content', 'admin-ui-v2.zip', 'v1');
      deployer.invalidate(stack, 'ui-invalidate', { distributionId: 'E-CHANGED', paths: ['/*'] });
    });

    expect(afterVersionBump.deploymentNonce).not.toEqual(before.deploymentNonce);
    expect(afterKeyChange.deploymentNonce).not.toEqual(before.deploymentNonce);
  });
});
