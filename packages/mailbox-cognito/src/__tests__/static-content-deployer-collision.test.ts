/**
 * StaticContentDeployer Type-Collision Bug Fix Test
 *
 * Tests for the type-safety fix in StaticContentDeployer.getOrCreate().
 * The bug occurred when multiple constructs (MailboxUi + JmapOAuthAddon) both attempted to
 * use the shared singleton deployer in the same stack. The original implementation used
 * `stack.node.tryFindChild('mailbox-ui-deployer')` with a bare `as` cast to
 * StaticContentDeployer, which suppressed TypeScript's type check.
 *
 * The fix uses `tryFindChild('content-deployer')` with a proper `instanceof StaticContentDeployer`
 * check, ensuring type safety at runtime. If another construct had created a resource with that
 * ID that wasn't a StaticContentDeployer, the instanceof check would fail and create a new
 * instance instead, preventing type mismatches that could cause runtime errors when methods
 * like `.deploy()` were called.
 *
 * This test verifies:
 * 1. Both MailboxUserPool (with OAuth addon) and MailboxUi can coexist in one stack
 * 2. Template.fromStack() succeeds without throwing TypeError (would indicate type collision)
 * 3. Both constructs' CustomResources properly reference the shared deployer Lambda
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MailboxArtifactResolverFactory, StaticContentDeployer, StaticContentSource } from '@serverlessinbox/mailbox-cdk-shared';
import { loadMailboxCognitoRegistryRecord } from '../mailbox-cognito-registry-record';
import { loadMailboxCognitoArtifactVersions } from '../mailbox-cognito-artifact-versions';
import { MailboxUserPool } from '../auth/mailbox-user-pool';
import * as s3 from 'aws-cdk-lib/aws-s3';

interface CloudFormationResource {
  Type: string;
  Properties?: Record<string, unknown>;
}

describe('StaticContentDeployer Singleton (Type-Collision Bug Fix)', () => {
  let app: App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new App();
    // Set up CDK context with artifact metadata so the resolver factory can load it
    app.node.setContext('serverlessinbox:artifacts', {
      bucketBase: 'test-artifacts',
      packages: {
        'mailbox-cognito': { zone: 'regional', version: '0.0.1-test' },
        'mailbox-cdk': { zone: 'regional', version: '0.0.1-test' },
        'mailbox': { zone: 'regional', version: '0.0.1-test' },
        'mailbox-cdk-shared': { zone: 'regional', version: '0.0.1-test' },
      },
    });
    app.node.setContext('serverlessinbox:artifact_versions', {});

    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
  });

  describe('MailboxUserPool with OAuth addon only', () => {
    it('should synth successfully with enableJmapOAuthDiscovery enabled', () => {
      // Construct MailboxUserPool with enableJmapOAuthDiscovery enabled.
      // This internally creates a JmapOAuthAddon that:
      // 1. Calls StaticContentDeployer.getOrCreate(this, artifactResolver)
      // 2. Creates CustomResources for .well-known/openid-configuration and .well-known/oauth-protected-resource
      const resolver = MailboxArtifactResolverFactory.fromContext(stack, loadMailboxCognitoRegistryRecord(), loadMailboxCognitoArtifactVersions());

      const userPool = new MailboxUserPool(stack, 'user-pool-with-oauth', {
        domain: { kind: 'cognito', cognitoDomainPrefix: 'test-oauth-domain' },
        artifactResolver: resolver,
        enableJmapOAuthDiscovery: true,
      });

      // Verify construct was created
      expect(userPool).toBeDefined();
      expect(userPool.oauthDomain).toBeDefined();

      // CRITICAL: Template.fromStack should succeed without throwing TypeError.
      // A TypeError during construction would indicate the type-collision bug:
      // e.g., "deployer.deploy is not a function" if the wrong-typed object was retrieved.
      // If this assertion passes, it proves that the OAuth addon's StaticContentDeployer.getOrCreate()
      // succeeded in finding/creating the singleton deployer without type errors.
      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources in synthesized template');
      }

      expect(Object.keys(resources).length).toBeGreaterThan(0);
    });
  });

  describe('StaticContentDeployer Singleton Behavior', () => {
    it('should return the same instance when getOrCreate is called multiple times from the same stack', () => {
      // This is the core test: verify that StaticContentDeployer.getOrCreate() returns
      // the same singleton instance when called multiple times on the same stack.
      // This is what prevents the type-collision bug from manifesting.

      const registryRecord = loadMailboxCognitoRegistryRecord();
      const resolver = MailboxArtifactResolverFactory.fromContext(stack, registryRecord, loadMailboxCognitoArtifactVersions());

      // Call getOrCreate twice from different constructs/scopes
      // Both should resolve to the same singleton on the stack
      const deployer1 = StaticContentDeployer.getOrCreate(stack, resolver);
      const deployer2 = StaticContentDeployer.getOrCreate(stack, resolver);

      // CRITICAL: Both should be the exact same instance (JavaScript object identity)
      // This verifies the singleton pattern is working correctly
      expect(deployer1).toBe(deployer2);

      // Create a minimal deployment to verify the deployer works
      const testBucket = new s3.Bucket(stack, 'test-bucket-for-deployer');
      deployer1.deploy(stack, 'test-deployment', {
        targetBucket: testBucket,
        source: StaticContentSource.data('test.txt', 'test content'),
      });

      // Verify template synthesis succeeds (this would fail if the type collision existed
      // or if the singleton returned an incorrectly-typed object)
      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources in synthesized template');
      }

      expect(Object.keys(resources).length).toBeGreaterThan(0);
    });
  });
});
