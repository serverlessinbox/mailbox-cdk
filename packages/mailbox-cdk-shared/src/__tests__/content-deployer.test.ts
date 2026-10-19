/// <reference types="jest" />

/**
 * Pins what StaticContentDeployer puts into the template: the custom resources of a deployment and of an
 * invalidation, the IAM statements each one needs (scoped to exact object ARNs and the one distribution),
 * the dependency of an invalidation on the deployments of its own scope, and the
 * deploymentNonce that makes CloudFormation re-run an invalidation exactly when the deployed content
 * changed. The custom resources and their grants are checked on the synthesized template, because that is
 * what CloudFormation and IAM act on.
 */

import { Construct } from 'constructs';
import { App, BootstraplessSynthesizer, Fn, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import type { IBucket } from 'aws-cdk-lib/aws-s3';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { StaticContentDeployer } from '../content-deployer';
import { StaticContentSource } from '../static-content-source';
import { statementsForAction } from '../cdk-test-support';

function newStack(): Stack {
  return new Stack(new App(), 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

function newArtifactResolver(stack: Stack): IArtifactResolver {
  const packages: Record<string, ArtifactPin> = {
    'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
  };
  return new PinnedArtifactResolver({
    packages,
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
}

function targetBucket(scope: Construct): IBucket {
  return Bucket.fromBucketArn(scope, 'target-bucket', 'arn:aws:s3:::ui-bucket');
}

/** The logical id CloudFormation gives a custom resource, which its dependents list in `DependsOn`. */
function logicalIdOf(stack: Stack, resource: { ref: string }): string {
  return stack.resolve(resource.ref).Ref;
}

describe('StaticContentDeployer', () => {
  let stack: Stack;
  let deployer: StaticContentDeployer;

  beforeEach(() => {
    stack = newStack();
    deployer = StaticContentDeployer.getOrCreate(stack, newArtifactResolver(stack));
  });

  describe('getOrCreate', () => {
    it('returns the one deployer of the stack on every call', () => {
      expect(StaticContentDeployer.getOrCreate(stack, newArtifactResolver(stack))).toBe(deployer);
    });

    it('places the deployer under the shared group of the stack', () => {
      expect(stack.node.findChild('shared').node.tryFindChild('content-deployer')).toBe(deployer);
    });

    it('runs a 15 minute, 1024 MB Lambda', () => {
      Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.handler',
        Timeout: 900,
        MemorySize: 1024,
      });
    });

    it('lets the Lambda read the status of its parent stack', () => {
      expect(statementsForAction(Template.fromStack(stack), 'cloudformation:DescribeStacks')).toEqual([
        expect.objectContaining({ Resource: { Ref: 'AWS::StackId' } }),
      ]);
    });
  });

  describe('deploy', () => {
    it('creates a Custom::ContentDeployment resource carrying the target bucket and the source', () => {
      const source = StaticContentSource.data('config/config.json', '{"a":1}', { contentType: 'application/json' });

      deployer.deploy(stack, 'ui-config', { targetBucket: targetBucket(stack), source });

      Template.fromStack(stack).hasResourceProperties('Custom::ContentDeployment', {
        ServiceTimeout: '900',
        targetBucket: 'ui-bucket',
        sources: [
          { kind: 'data', key: 'config/config.json', body: '{"a":1}', contentType: 'application/json' },
        ],
        distributionId: Match.absent(),
        invalidationPaths: Match.absent(),
        deploymentNonce: Match.absent(),
      });
    });

    it('lets a data source write exactly its own object and nothing else', () => {
      deployer.deploy(stack, 'ui-config', {
        targetBucket: targetBucket(stack),
        source: StaticContentSource.data('config/config.json', '{"a":1}'),
      });

      const template = Template.fromStack(stack);
      expect(statementsForAction(template, 's3:PutObject')).toEqual([
        expect.objectContaining({
          Action: ['s3:PutObject', 's3:DeleteObject'],
          Resource: 'arn:aws:s3:::ui-bucket/config/config.json',
        }),
      ]);
      expect(statementsForAction(template, 's3:ListBucket')).toEqual([]);
      expect(statementsForAction(template, 's3:GetObject')).toEqual([]);
    });

    it('lets a zip source write under its prefix, list the target bucket and read its source archive', () => {
      deployer.deploy(stack, 'ui-content', {
        targetBucket: targetBucket(stack),
        source: StaticContentSource.zipFromBucket('artifacts-bucket', 'ui/admin-ui.zip', 'content'),
      });

      const template = Template.fromStack(stack);
      expect(statementsForAction(template, 's3:PutObject')).toEqual([
        expect.objectContaining({
          Action: ['s3:PutObject', 's3:DeleteObject'],
          Resource: 'arn:aws:s3:::ui-bucket/content/*',
        }),
      ]);
      expect(statementsForAction(template, 's3:ListBucket')).toEqual([
        expect.objectContaining({ Action: 's3:ListBucket', Resource: 'arn:aws:s3:::ui-bucket' }),
      ]);
      expect(statementsForAction(template, 's3:GetObject')).toEqual([
        expect.objectContaining({
          Action: ['s3:GetObject', 's3:GetObjectVersion'],
          Resource: 'arn:aws:s3:::artifacts-bucket/ui/admin-ui.zip',
        }),
      ]);
    });
  });

  describe('invalidate', () => {
    it('creates a Custom::ContentInvalidation resource with no sources', () => {
      deployer.invalidate(stack, 'ui-invalidate', { distributionId: 'E1234567890ABC', paths: ['/*'] });

      Template.fromStack(stack).hasResourceProperties('Custom::ContentInvalidation', {
        ServiceTimeout: '900',
        sources: [],
        distributionId: 'E1234567890ABC',
        invalidationPaths: ['/*'],
        targetBucket: Match.absent(),
        deploymentNonce: Match.absent(),
      });
    });

    it('scopes cloudfront:CreateInvalidation to the target distribution ARN', () => {
      deployer.invalidate(stack, 'ui-invalidate', { distributionId: 'E1234567890ABC', paths: ['/*'] });

      // Aws.PARTITION/Aws.ACCOUNT_ID are CFN pseudo-parameters — CDK renders the concatenation as
      // an Fn::Join of literal segments and { Ref: 'AWS::Partition' | 'AWS::AccountId' }, not a
      // plain resolved string, even with a fixed-account test stack.
      expect(statementsForAction(Template.fromStack(stack), 'cloudfront:CreateInvalidation')).toEqual([
        expect.objectContaining({
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
      ]);
    });

    it('depends on the deployments of its own scope and on no others', () => {
      const uiScope = new Construct(stack, 'ui');
      const otherScope = new Construct(stack, 'other');
      const uiContent = deployer.deploy(uiScope, 'content', {
        targetBucket: targetBucket(uiScope),
        source: StaticContentSource.zipFromBucket('artifacts-bucket', 'admin-ui.zip', 'content/'),
      });
      const uiConfig = deployer.deploy(uiScope, 'config', {
        targetBucket: targetBucket(new Construct(uiScope, 'config-target')),
        source: StaticContentSource.data('config.json', '{}'),
      });
      deployer.deploy(otherScope, 'content', {
        targetBucket: targetBucket(otherScope),
        source: StaticContentSource.data('other.json', '{}'),
      });

      deployer.invalidate(uiScope, 'invalidate', { distributionId: 'E-UI', paths: ['/*'] });

      const invalidations = Object.values(Template.fromStack(stack).findResources('Custom::ContentInvalidation'));
      expect(invalidations).toHaveLength(1);
      expect([...invalidations[0].DependsOn].sort()).toEqual(
        [logicalIdOf(stack, uiContent), logicalIdOf(stack, uiConfig)].sort(),
      );
    });
  });

  describe('invalidate deploymentNonce', () => {
    // Regression coverage for a defect where the invalidation's properties were caller-supplied and
    // constant, so CloudFormation never re-invoked it on redeploy and stale content stayed cached.

    /** The properties of the one invalidation resource of a stack built by `configure`. */
    function synthInvalidationProperties(
      configure: (deployer: StaticContentDeployer, stack: Stack) => void,
    ): Record<string, unknown> {
      const configuredStack = newStack();
      configure(StaticContentDeployer.getOrCreate(configuredStack, newArtifactResolver(configuredStack)), configuredStack);

      const invalidations = Object.values(Template.fromStack(configuredStack).findResources('Custom::ContentInvalidation'));
      expect(invalidations).toHaveLength(1);
      return invalidations[0].Properties;
    }

    function deployUi(source: ReturnType<typeof StaticContentSource.data>) {
      return (configuredDeployer: StaticContentDeployer, configuredStack: Stack) => {
        configuredDeployer.deploy(configuredStack, 'ui-content', { targetBucket: targetBucket(configuredStack), source });
        configuredDeployer.invalidate(configuredStack, 'ui-invalidate', { distributionId: 'E-UI', paths: ['/*'] });
      };
    }

    const zip = (key: string, versionId: string) =>
      StaticContentSource.zipFromBucket('artifacts-bucket', key, 'content/', { sourceVersionId: versionId });

    it('gives identical properties across two synths of identical inputs', () => {
      expect(synthInvalidationProperties(deployUi(zip('admin-ui.zip', 'v1')))).toEqual(
        synthInvalidationProperties(deployUi(zip('admin-ui.zip', 'v1'))),
      );
    });

    it('changes when the deployed archive version changes', () => {
      const before = synthInvalidationProperties(deployUi(zip('admin-ui.zip', 'v1')));
      const after = synthInvalidationProperties(deployUi(zip('admin-ui.zip', 'v2')));

      expect(after.deploymentNonce).not.toEqual(before.deploymentNonce);
    });

    it('changes when the deployed archive key changes', () => {
      const before = synthInvalidationProperties(deployUi(zip('admin-ui.zip', 'v1')));
      const after = synthInvalidationProperties(deployUi(zip('admin-ui-v2.zip', 'v1')));

      expect(after.deploymentNonce).not.toEqual(before.deploymentNonce);
    });

    it('changes when the body of a deployed data source changes, without embedding the body', () => {
      const before = synthInvalidationProperties(deployUi(StaticContentSource.data('config.json', '{"theme":"light"}')));
      const after = synthInvalidationProperties(deployUi(StaticContentSource.data('config.json', '{"theme":"dark"}')));

      expect(after.deploymentNonce).not.toEqual(before.deploymentNonce);
      expect(JSON.stringify(after)).not.toContain('dark');
    });

    describe('a data source body with tokens', () => {
      // Each call mints new tokens, so every synth numbers its placeholders differently.
      const deployBody = (literal: string) =>
        deployUi(
          StaticContentSource.data(
            'config.json',
            `{"theme":"${literal}","pool":"${Fn.importValue('pool-id')}","bucket":"${Fn.ref('UiBucket')}"}`,
          ),
        );

      it('gives the same nonce across synths of the same body', () => {
        const first = synthInvalidationProperties(deployBody('light'));
        const second = synthInvalidationProperties(deployBody('light'));

        expect(second.deploymentNonce).toEqual(first.deploymentNonce);
      });

      it('renders each token as a CloudFormation intrinsic, not as placeholder text', () => {
        const nonce = synthInvalidationProperties(deployBody('light')).deploymentNonce;

        expect(JSON.stringify(nonce)).not.toContain('Token[');
        expect(nonce).toEqual({
          'Fn::Join': ['', [expect.stringMatching(/^data:config\.json:[0-9a-f]{64}:/), { 'Fn::ImportValue': 'pool-id' }, ':', { Ref: 'UiBucket' }]],
        });
      });

      it('changes when a literal of the body changes', () => {
        const before = synthInvalidationProperties(deployBody('light'));
        const after = synthInvalidationProperties(deployBody('dark'));

        expect(after.deploymentNonce).not.toEqual(before.deploymentNonce);
      });
    });

    it('ignores the deployments of other scopes', () => {
      const properties = synthInvalidationProperties((configuredDeployer, configuredStack) => {
        const uiScope = new Construct(configuredStack, 'ui');
        const otherScope = new Construct(configuredStack, 'other');
        configuredDeployer.deploy(otherScope, 'content', {
          targetBucket: targetBucket(otherScope),
          source: zip('other.zip', 'v9'),
        });
        configuredDeployer.deploy(uiScope, 'content', {
          targetBucket: targetBucket(uiScope),
          source: zip('admin-ui.zip', 'v1'),
        });
        configuredDeployer.invalidate(uiScope, 'invalidate', { distributionId: 'E-UI', paths: ['/*'] });
      });

      expect(properties.deploymentNonce).toBe('zip:artifacts-bucket:admin-ui.zip:v1');
    });

    it('has no deploymentNonce when the scope deployed nothing', () => {
      const properties = synthInvalidationProperties((configuredDeployer, configuredStack) => {
        const otherScope = new Construct(configuredStack, 'other');
        configuredDeployer.deploy(otherScope, 'content', {
          targetBucket: targetBucket(otherScope),
          source: zip('other.zip', 'v9'),
        });
        configuredDeployer.invalidate(configuredStack, 'invalidate', { distributionId: 'E-UI', paths: ['/*'] });
      });

      expect(properties.deploymentNonce).toBeUndefined();
    });

    it('joins the identities of every deployment of the scope, in deployment order', () => {
      const properties = synthInvalidationProperties((configuredDeployer, configuredStack) => {
        configuredDeployer.deploy(configuredStack, 'ui-content', {
          targetBucket: targetBucket(configuredStack),
          source: zip('admin-ui.zip', 'v1'),
        });
        configuredDeployer.deploy(configuredStack, 'ui-extra', {
          targetBucket: targetBucket(new Construct(configuredStack, 'extra-target')),
          source: zip('extra.zip', 'v9'),
        });
        configuredDeployer.invalidate(configuredStack, 'ui-invalidate', { distributionId: 'E-UI', paths: ['/*'] });
      });

      expect(properties.deploymentNonce).toBe('zip:artifacts-bucket:admin-ui.zip:v1|zip:artifacts-bucket:extra.zip:v9');
    });
  });
});
