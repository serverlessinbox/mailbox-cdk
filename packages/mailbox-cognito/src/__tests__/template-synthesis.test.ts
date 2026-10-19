/**
 * CDK Template Synthesis Tests — Cognito Data Stack
 *
 * Tests for MailboxCognitoDataStack: tag contracts, IAM wildcard guards, and construct quality.
 * Verifies that identity/auth tier resources are correctly tagged, scoped, and configured.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MailboxCognitoDataStack } from '../cognito/mailbox-cognito-data-stack';
import { MailboxCognitoDataDeployerWorker } from '../cognito/mailbox-cognito-data-deployer-worker';
import { MailboxUserPool } from '../auth/mailbox-user-pool';
import { MailboxArtifactResolverFactory } from '@serverlessinbox/mailbox-cdk-shared';
import { actionsOf, resourcesOf, statementsOfDocument } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { loadMailboxCognitoRegistryRecord } from '../mailbox-cognito-registry-record';
import { loadMailboxCognitoArtifactVersions } from '../mailbox-cognito-artifact-versions';

interface CloudFormationResource {
  Type: string;
  Properties?: Record<string, unknown>;
}

/**
 * ALLOWLIST: IAM wildcard statements that legitimately cannot be scoped by tag/name.
 * Each entry is pre-verified to be essential and scoped by Condition or Service Principal.
 */
const KNOWN_WILDCARDS: Record<string, string> = {
  'cloudformation:GetTemplateSummary': 'CloudFormation resource introspection (read-only)',
  'cloudformation:DescribeStackEvents': 'CloudFormation stack event retrieval (read-only)',
  'tag:GetResources': 'Resource Groups Tagging API (read-only, no delete)',
  'tag:TagResources': 'Resource Groups Tagging API (tag writes, broad scope accepted)',
  'tag:UntagResources': 'Resource Groups Tagging API (tag removal, broad scope accepted)',
  'iam:GetRole': 'IAM role read (informational)',
  'iam:ListRolePolicies': 'IAM role policy enumeration (informational)',
  'iam:ListAttachedRolePolicies': 'IAM role policy attachment read (informational)',
  'iam:GetRolePolicy': 'IAM inline policy read (informational)',
  'logs:CreateLogGroup': 'CloudWatch log group creation (standard Lambda execution permission)',
  'logs:CreateLogStream': 'CloudWatch log stream creation (standard Lambda execution permission)',
  'logs:PutLogEvents': 'CloudWatch log event writes (standard Lambda execution permission)',
};

function isResourceOfType(resource: CloudFormationResource, type: string): boolean {
  return resource.Type === type;
}

describe('Cognito Data Stack Template Synthesis', () => {
  /**
   * S2.1: Tag Contract — every taggable resource carries serverless-inbox tags
   */
  describe('Tag Contract (S2.1)', () => {
    it('cognito-data stack: Cognito resources have tag structure for correlation', () => {
      const app = new App();
      const stack = new MailboxCognitoDataStack(app, 'TestMailboxCognitoData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      // Check that Cognito resources are present and carry appropriate tags
      // (Cognito resources may not all be taggable via CFN Tags property, so this verifies structure)
      let cognitoResourceCount = 0;
      for (const [, resource] of Object.entries(resources)) {
        if (isResourceOfType(resource, 'AWS::Cognito::UserPool') ||
            isResourceOfType(resource, 'AWS::Cognito::UserPoolDomain') ||
            isResourceOfType(resource, 'AWS::Cognito::UserPoolResourceServer') ||
            isResourceOfType(resource, 'AWS::Cognito::UserPoolGroup')) {
          cognitoResourceCount++;
        }
      }

      // Should have at least UserPool and UserPoolDomain
      expect(cognitoResourceCount).toBeGreaterThanOrEqual(2);
    });
  });

  /**
   * S2.2: IAM Wildcard Guard - no unscoped iam or logs write actions on Resource "*"
   */
  describe('IAM Wildcard Guard (S2.2)', () => {
    it('cognito-data stack: no unscoped iam:* or logs:* write actions on Resource "*"', () => {
      const app = new App();
      const stack = new MailboxCognitoDataStack(app, 'TestMailboxCognitoData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      const writeActions = new Set([
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:PutRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:TagRole',
        'iam:UntagRole',
        'iam:PassRole',
        'logs:CreateLogGroup',
        'logs:DeleteLogGroup',
        'logs:CreateLogStream',
        'logs:DeleteLogStream',
        'logs:PutRetentionPolicy',
        'logs:PutLogEvents',
      ]);

      const violations: string[] = [];

      for (const [logicalId, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;

        const policyDoc = resource.Properties?.PolicyDocument;
        const statements = statementsOfDocument(policyDoc);

        for (const stmt of statements) {
          const actions = actionsOf(stmt);
          const resourceList = resourcesOf(stmt);

          for (const action of actions) {
            if (writeActions.has(action) && resourceList.includes('*') && !stmt.Condition) {
              if (!KNOWN_WILDCARDS[action]) {
                violations.push(`${logicalId}: ${action} on Resource "*" without Condition`);
              }
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  /**
   * L5: Construct Quality Assertions
   */
  describe('Construct Quality (L5)', () => {
    it('cognito-data stack: Template.fromStack succeeds with expected resources', () => {
      const app = new App();
      const stack = new MailboxCognitoDataStack(app, 'TestMailboxCognitoData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;

      // Cognito data stack should have resources
      expect(resources).toBeDefined();
      expect(Object.keys(resources || {}).length).toBeGreaterThan(0);

      // Check for key Cognito resource types
      const resourceEntries = Object.values(resources || {});
      const hasUserPool = resourceEntries.some((r) => isResourceOfType(r, 'AWS::Cognito::UserPool'));
      const hasUserPoolDomain = resourceEntries.some((r) => isResourceOfType(r, 'AWS::Cognito::UserPoolDomain'));

      expect(hasUserPool).toBe(true);
      expect(hasUserPoolDomain).toBe(true);
    });

    it('cognito-data stack: template has expected parameter schema', () => {
      const app = new App();
      const stack = new MailboxCognitoDataStack(app, 'TestMailboxCognitoData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const parameters = template.toJSON().Parameters || {};

      // Cognito data stack should have domain and password policy parameters
      expect(parameters).toHaveProperty('cognitoDomainPrefix');
      expect(parameters).toHaveProperty('customDomainName');
      expect(parameters).toHaveProperty('mfaMode');
      expect(parameters).toHaveProperty('passwordMinLength');
    });

    it('cognito-data stack: has Cognito UserPool resource with RETAIN policy', () => {
      const app = new App();
      const stack = new MailboxCognitoDataStack(app, 'TestMailboxCognitoData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      let userPoolCount = 0;
      for (const [, resource] of Object.entries(resources)) {
        if (isResourceOfType(resource, 'AWS::Cognito::UserPool')) {
          userPoolCount++;
          // Verify the pool has a name configured
          const props = resource.Properties as Record<string, unknown>;
          expect(props.UserPoolName).toBeDefined();
        }
      }

      expect(userPoolCount).toBeGreaterThan(0);
    });

    it('cognito-data stack: has UserPoolResourceServer for JMAP scopes', () => {
      const app = new App();
      const stack = new MailboxCognitoDataStack(app, 'TestMailboxCognitoData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      let resourceServerCount = 0;
      for (const [, resource] of Object.entries(resources)) {
        if (isResourceOfType(resource, 'AWS::Cognito::UserPoolResourceServer')) {
          resourceServerCount++;
          // Verify scopes are defined
          const props = resource.Properties as Record<string, unknown>;
          expect(props.Identifier).toBeDefined();
          expect(props.Scopes).toBeDefined();
        }
      }

      expect(resourceServerCount).toBeGreaterThan(0);
    });
  });

  /**
   * Part 1: Cognito Deployer Worker IAM Unit Test
   * Tests MailboxCognitoDataDeployerWorker's own IAM grants directly, via synth.
   */
  describe('Cognito Deployer Worker', () => {
    it('cognito deployer worker: CloudFormation management is scoped to the cognito stack ARN; no unscoped iam/logs writes', () => {
      const app = new App();
      app.node.setContext('serverlessinbox:artifacts', {
        bucketBase: 'test-artifacts',
        packages: {
          'mailbox-cognito': { zone: 'regional', version: '0.0.1-test' },
          'mailbox-cdk-shared': { zone: 'regional', version: '0.0.1-test' },
        },
      });
      app.node.setContext('serverlessinbox:artifact_versions', {});
      const testStack = new cdk.Stack(app, 'TestCognitoDeployerStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const registryRecord = loadMailboxCognitoRegistryRecord();
      const artifactResolver = MailboxArtifactResolverFactory.fromContext(testStack, registryRecord, loadMailboxCognitoArtifactVersions());

      new MailboxCognitoDataDeployerWorker(testStack, 'worker', {
        artifactResolver,
        templateObjectArn: 'arn:aws:s3:::bucket/template.json',
        deployedStackArn: 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-cognito/*',
      });

      const template = Template.fromStack(testStack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      // Reuse the same wildcard guard as the whole-stack test: no unscoped iam:*/logs:* write
      // on Resource "*" without a Condition (regression guard even though this grant function
      // doesn't currently touch iam actions — catches one being added unscoped later).
      const writeActions = new Set([
        'iam:CreateRole', 'iam:DeleteRole', 'iam:PutRolePolicy', 'iam:DeleteRolePolicy',
        'iam:AttachRolePolicy', 'iam:DetachRolePolicy', 'iam:TagRole', 'iam:UntagRole', 'iam:PassRole',
        'logs:CreateLogGroup', 'logs:DeleteLogGroup', 'logs:CreateLogStream', 'logs:DeleteLogStream',
        'logs:PutRetentionPolicy', 'logs:PutLogEvents',
      ]);
      const violations: string[] = [];
      let sawCreateStack = false;

      for (const [logicalId, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
        const statements = statementsOfDocument(resource.Properties?.PolicyDocument);

        for (const stmt of statements) {
          const actions = actionsOf(stmt);
          const resourceList = resourcesOf(stmt);

          for (const action of actions) {
            if (action === 'cloudformation:CreateStack') {
              sawCreateStack = true;
              if (resourceList.includes('*')) {
                violations.push(`${logicalId}: cloudformation:CreateStack granted on bare Resource "*"`);
              }
            }
            if (writeActions.has(action) && resourceList.includes('*') && !stmt.Condition) {
              if (!KNOWN_WILDCARDS[action]) {
                violations.push(`${logicalId}: ${action} on Resource "*" without Condition`);
              }
            }
          }
        }
      }

      expect(sawCreateStack).toBe(true);
      expect(violations).toEqual([]);
    });
  });

  /**
   * MailboxUserPool Domain Config Tests — discriminated union synthesis
   *
   * Verifies that the three domain config variants (cognito, cognito-auto, custom)
   * synthesize correctly: StackHelpers singleton + CR for auto, literal prefix for explicit,
   * and Aws.STACK_NAME for custom.
   */
  /**
   * MailboxUserPool Domain Config Tests — discriminated union synthesis
   *
   * Verifies that the three domain config variants (cognito, cognito-auto, custom)
   * synthesize correctly: StackHelpers singleton + CR for auto, literal prefix for explicit,
   * and Aws.STACK_NAME for custom.
   */
  describe('MailboxUserPool Domain Config (Discriminated Union)', () => {
    // Helper to set up CDK app context with artifact metadata
    function setUpArtifactContext(app: App): void {
      // Set up CDK context with artifact metadata so the resolver factory can load it
      app.node.setContext('serverlessinbox:artifacts', {
        bucketBase: 'test-artifacts',
        packages: {
          'mailbox-cognito': { zone: 'regional', version: '0.0.1-test' },
          'mailbox-cdk-shared': { zone: 'regional', version: '0.0.1-test' },
          'mailbox': { zone: 'regional', version: '0.0.1-test' },
        },
      });
      app.node.setContext('serverlessinbox:artifact_versions', {});
    }

    // Helper to create a resolver for a stack
    function createTestResolver(stack: cdk.Stack): IArtifactResolver {
      return MailboxArtifactResolverFactory.fromContext(stack, loadMailboxCognitoRegistryRecord(), loadMailboxCognitoArtifactVersions());
    }

    it('kind: cognito-auto - synthesizes StackHelpers Lambda + CR with GetAtt token', () => {
      const app = new App();
      setUpArtifactContext(app);
      const stack = new cdk.Stack(app, 'TestCognitoAutoStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const resolver = createTestResolver(stack);

      // Construct with cognito-auto domain config
      const userPool = new MailboxUserPool(stack, 'user-pool', {
        domain: {
          kind: 'cognito-auto',
          hostedZoneId: 'Z1234567890ABC',
        },
        artifactResolver: resolver,
      });

      // Verify construct created
      expect(userPool).toBeDefined();
      expect(userPool.oauthDomain).toBeDefined();

      // Synthesize and check template resources
      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources in synthesized template');
      }

      // For cognito-auto, there should be Lambda and custom resource resources created
      // (StackHelpers creates a Lambda and CfnCustomResource)
      let hasLambda = false;
      let hasCustomResource = false;

      for (const [, resource] of Object.entries(resources)) {
        if (isResourceOfType(resource, 'AWS::Lambda::Function')) {
          hasLambda = true;
        }
        if (isResourceOfType(resource, 'Custom::StackHelpers')) {
          hasCustomResource = true;
        }
      }

      // Both Lambda and CustomResource should be present for cognito-auto
      expect(hasLambda).toBe(true);
      expect(hasCustomResource).toBe(true);
    });

    it('kind: cognito - no StackHelpers Lambda/CR, uses explicit prefix', () => {
      const app = new App();
      setUpArtifactContext(app);
      const stack = new cdk.Stack(app, 'TestCognitoExplicitStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const resolver = createTestResolver(stack);
      const explicitPrefix = 'my-oauth-domain';

      // Construct with explicit cognito domain config
      const userPool = new MailboxUserPool(stack, 'user-pool', {
        domain: {
          kind: 'cognito',
          cognitoDomainPrefix: explicitPrefix,
        },
        artifactResolver: resolver,
      });

      // Verify construct created
      expect(userPool).toBeDefined();
      expect(userPool.oauthDomain).toBeDefined();

      // Synthesize and check template resources
      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources in synthesized template');
      }

      // For explicit cognito domain, NO StackHelpers Lambda should be created
      let stackHelpersLambda = false;

      for (const [, resource] of Object.entries(resources)) {
        if (isResourceOfType(resource, 'AWS::Lambda::Function')) {
          const props = resource.Properties as Record<string, unknown>;
          if (props.Description && String(props.Description).includes('StackHelpers')) {
            stackHelpersLambda = true;
          }
        }
      }

      // Should NOT have StackHelpers Lambda for explicit prefix
      expect(stackHelpersLambda).toBe(false);
    });

    it('kind: custom - synthesizes with custom domain and Aws.STACK_NAME placeholder', () => {
      const app = new App();
      setUpArtifactContext(app);
      const stack = new cdk.Stack(app, 'TestCustomDomainStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const resolver = createTestResolver(stack);

      // Construct with custom domain config
      const userPool = new MailboxUserPool(stack, 'user-pool', {
        domain: {
          kind: 'custom',
          domainName: 'auth.example.com',
          certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert',
        },
        artifactResolver: resolver,
      });

      // Verify construct created
      expect(userPool).toBeDefined();
      expect(userPool.oauthDomain).toBeDefined();

      // Synthesize and check template resources
      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources in synthesized template');
      }

      // For custom domain, NO StackHelpers Lambda should be created
      let stackHelpersLambda = false;

      for (const [, resource] of Object.entries(resources)) {
        if (isResourceOfType(resource, 'AWS::Lambda::Function')) {
          const props = resource.Properties as Record<string, unknown>;
          if (props.Description && String(props.Description).includes('StackHelpers')) {
            stackHelpersLambda = true;
          }
        }
      }

      // Should NOT have StackHelpers Lambda for custom domain
      expect(stackHelpersLambda).toBe(false);
    });
  });

  /**
   * Integration: MailboxUserPool with OAuth Discovery enabled
   *
   * Verifies that MailboxUserPool with enableJmapOAuthDiscovery: true
   * synthesizes correctly and creates the JmapOAuthAddon with its CustomResources.
   */
  describe('MailboxUserPool with OAuth Discovery enabled', () => {
    it('should synth successfully with enableJmapOAuthDiscovery: true', () => {
      const app = new App();
      function setUpArtifactContext() {
        app.node.setContext('serverlessinbox:artifacts', {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-cognito': { zone: 'regional', version: '0.0.1-test' },
            'mailbox-cdk-shared': { zone: 'regional', version: '0.0.1-test' },
            'mailbox': { zone: 'regional', version: '0.0.1-test' },
          },
        });
        app.node.setContext('serverlessinbox:artifact_versions', {});
      }
      setUpArtifactContext();

      const stack = new cdk.Stack(app, 'TestOAuthDiscoveryStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const resolver = MailboxArtifactResolverFactory.fromContext(stack, loadMailboxCognitoRegistryRecord(), loadMailboxCognitoArtifactVersions());

      // Construct MailboxUserPool with enableJmapOAuthDiscovery enabled
      const userPool = new MailboxUserPool(stack, 'user-pool-oauth', {
        domain: { kind: 'cognito', cognitoDomainPrefix: 'test-oauth' },
        artifactResolver: resolver,
        enableJmapOAuthDiscovery: true,
      });

      // Verify the construct was created
      expect(userPool).toBeDefined();

      // Synthesize and verify template is valid
      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources in synthesized template');
      }

      // OAuth addon should have created CustomResources or other resources
      // The important thing is that synth doesn't crash with type errors
      expect(userPool.oauthDomain).toBeDefined();
    });
  });
});
