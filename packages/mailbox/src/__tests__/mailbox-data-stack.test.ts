/**
 * MailboxDataStack Template Synthesis Tests
 *
 * Tests for synthesized CloudFormation templates from MailboxDataStack.
 * Verifies: tag contracts, IAM wildcard guards, deployer policy shapes, and construct quality.
 *
 * Security audit findings (2026-07-09):
 * - S2 critical: Data deployer granted unscoped iam:* and logs:* write actions on Resource "*"
 * These tests lock in the fixes and catch regressions.
 */

import { ArtifactZone, PinnedArtifactResolver }         from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }                             from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, resourcesOf, statementsOfDocument } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { ArtifactObject, DeployedStack }                from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                     from 'aws-cdk-lib/assertions';
import * as cdk                                         from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                from 'aws-cdk-lib';

import { MailboxDataStack }                             from '../core/data/mailbox-data-stack';
import { MailboxDataDeployerWorkerLambda }              from '../resources/lambdas/mailbox-data-deployer-worker-lambda';

import {
  CloudFormationResource,
  CloudFormationTag,
  KNOWN_WILDCARDS,
  getTagValue,
  isResourceOfType,
  readTags,
} from './iam-test-helpers';

describe('MailboxDataStack Template Synthesis', () => {
  /**
   * S2.1: Tag Contract — every taggable resource carries serverless-inbox:root-stack
   */
  describe('Tag Contract (S2.1)', () => {
    it('data stack: all taggable resources have correct root-stack tag', () => {
      const app   = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      let taggedResourceCount = 0;
      for (const [, resource] of Object.entries(resources)) {
        const isTable  = isResourceOfType(resource, 'AWS::DynamoDB::Table');
        const isBucket = isResourceOfType(resource, 'AWS::S3::Bucket');
        if (!isTable && !isBucket) {continue;}

        const tags = readTags(resource);
        if (tags === undefined) {continue;}
        taggedResourceCount++;

        const rootStackTag = tags.find((t) => t.Key === 'serverless-inbox:root-stack');
        expect(rootStackTag).toBeDefined();
        const tagValue = rootStackTag ? getTagValue(rootStackTag) : undefined;
        expect(tagValue).toEqual({ Ref: 'rootStack' });
      }

      // Data stack should have multiple DynamoDB tables and S3 buckets
      expect(taggedResourceCount).toBeGreaterThan(2);
    });

    it('data stack: declares a mandatory rootStackId parameter and tags its tables and buckets with it', () => {
      const app   = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template   = Template.fromStack(stack);
      const parameters = template.toJSON().Parameters as Record<string, { Type: string; Default?: string }>;
      expect(parameters.rootStackId).toEqual(expect.objectContaining({ Type: 'String' }));
      expect(parameters.rootStackId.Default).toBeUndefined();

      const resources = Object.values(template.toJSON().Resources as Record<string, CloudFormationResource>);
      const tagged    = resources.filter(
        (r) => (isResourceOfType(r, 'AWS::DynamoDB::Table') || isResourceOfType(r, 'AWS::S3::Bucket')) && Array.isArray(r.Properties?.Tags),
      );
      expect(tagged.length).toBeGreaterThan(2);
      for (const resource of tagged) {
        const tag = (resource.Properties?.Tags as CloudFormationTag[]).find((t) => t.Key === 'serverless-inbox:root-stack-id');
        expect(tag ? getTagValue(tag) : undefined).toEqual({ Ref: 'rootStackId' });
      }
    });
  });

  /**
   * S2.2: IAM Wildcard Guard - no iam or logs write actions on Resource * without Condition
   */
  describe('IAM Wildcard Guard (S2.2)', () => {
    it('data stack: no unscoped iam:* or logs:* write actions on Resource "*"', () => {
      const app   = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
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
        'logs:CreateLogGroup',
        'logs:DeleteLogGroup',
        'logs:CreateLogStream',
        'logs:DeleteLogStream',
        'logs:PutLogEvents',
      ]);

      const violations: string[] = [];

      for (const [logicalId, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) {continue;}

        const policyDoc  = resource.Properties?.PolicyDocument;
        const statements = statementsOfDocument(policyDoc);

        for (const stmt of statements) {
          const actions      = actionsOf(stmt);
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
    it('data stack: Template.fromStack succeeds with sane resource counts', () => {
      const app   = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;

      // Data stack should have multiple DynamoDB tables and S3 buckets
      const resourceEntries = Object.values(resources || {});
      const tableCount      = resourceEntries.filter((r) => isResourceOfType(r, 'AWS::DynamoDB::Table')).length;
      const bucketCount     = resourceEntries.filter((r) => isResourceOfType(r, 'AWS::S3::Bucket')).length;

      expect(tableCount).toBeGreaterThanOrEqual(4); // At least 4 data tables expected
      expect(bucketCount).toBeGreaterThanOrEqual(1); // At least 1 blob store bucket
    });

    it('data stack: S3 buckets exist in template', () => {
      const app   = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      // Verify S3 buckets exist in the template
      const buckets = Object.values(resources).filter((r) => isResourceOfType(r, 'AWS::S3::Bucket'));
      expect(buckets.length).toBeGreaterThanOrEqual(1);

      // Verify at least one bucket has proper configurations
      for (const bucket of buckets) {
        if (!isResourceOfType(bucket, 'AWS::S3::Bucket')) {continue;}
        // Buckets should exist with some configuration (versioning, encryption, etc.)
        expect(bucket.Properties).toBeDefined();
      }
    });

    it('data stack: template has expected parameter schema', () => {
      const app   = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template            = Template.fromStack(stack);
      const parameters: unknown = template.toJSON().Parameters ?? {};

      // Data stack should have root stack correlation parameters
      expect(parameters).toHaveProperty('rootStack');
      expect(parameters).toHaveProperty('nameBase');
    });
  });

  /**
   * Extended L5 Assertions
   */
  describe('Extended L5 Assertions', () => {
    /**
     * S3 Bucket Configuration Verification
     */
    it('data stack: S3 buckets have proper configuration', () => {
      const app   = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      // Verify S3 buckets exist and have PublicAccessBlockConfiguration
      let bucketWithBlocksCount = 0;

      for (const [, resource] of Object.entries(resources)) {
        if (isResourceOfType(resource, 'AWS::S3::Bucket')) {
          const props = resource.Properties as Record<string, unknown>;
          // Buckets should have PublicAccessBlockConfiguration with all flags true
          const blockConfig = props.PublicAccessBlockConfiguration as Record<string, boolean> | undefined;
          if (blockConfig) {
            // Assert the actual security property is present, not just checking that properties exist
            expect(blockConfig.BlockPublicAcls).toEqual(true);
            expect(blockConfig.BlockPublicPolicy).toEqual(true);
            expect(blockConfig.IgnorePublicAcls).toEqual(true);
            expect(blockConfig.RestrictPublicBuckets).toEqual(true);
            bucketWithBlocksCount++;
          }
        }
      }

      // Should have at least one S3 bucket with public access block configured
      expect(bucketWithBlocksCount).toBeGreaterThan(0);
    });

    /**
     * DynamoDB Table Configuration Verification
     */
    it('data stack: DynamoDB tables are retained on delete/update (not accidentally destroyable)', () => {
      const app   = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource & { DeletionPolicy?: string; UpdateReplacePolicy?: string }> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      let tableCount = 0;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::DynamoDB::Table')) {continue;}
        tableCount++;

        // Bug caught: if removalPolicy is ever changed to RemovalPolicy.DESTROY, DeletionPolicy
        // becomes "Delete" and this assertion fails. Values confirmed empirically against the
        // real synthesized output for RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE (base-table.ts).
        expect(resource.DeletionPolicy).toEqual('RetainExceptOnCreate');
        expect(resource.UpdateReplacePolicy).toEqual('Retain');
      }

      expect(tableCount).toBeGreaterThanOrEqual(4);
    });
  });

  /**
   * Deployer Worker IAM
   * Tests MailboxDataDeployerWorkerLambda's own IAM grants directly — instead of the full
   * customer-facing stack (which lives in a different repo, mailbox-apps, and can't be
   * synthesized from here due to separate Yarn PnP roots).
   */
  describe('Deployer Worker IAM', () => {
    it('data deployer worker: DynamoDB/S3 write actions are scoped to the deterministic resource-name pattern, never Resource "*"', () => {
      const app       = new App();
      const testStack = new cdk.Stack(app, 'TestDataDeployerStack', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const packages: Record<string, ArtifactPin> = {
        'mailbox-cdk-shared': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
      };
      const artifactResolver                      = new PinnedArtifactResolver({
        packages,
        location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
        deploymentRegion: testStack.region,
      });

      new MailboxDataDeployerWorkerLambda(testStack, 'worker', {
        artifactResolver,
        dataStack:     new DeployedStack('arn:aws:cloudformation:us-west-2:123456789012:stack/test-root-data/*'),
        dataStackName: 'test-root-data',
        template:      new ArtifactObject(artifactResolver, 'mailbox-cdk-shared', 'template.json'),
        nameBase:      'test-root-data',
      });

      const template  = Template.fromStack(testStack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      const scopedWriteActions   = new Set([
        'dynamodb:CreateTable', 'dynamodb:DeleteTable', 'dynamodb:UpdateTable',
        's3:CreateBucket', 's3:DeleteBucket', 's3:PutBucketPolicy',
      ]);
      const violations: string[] = [];
      let sawAnyScopedAction     = false;

      for (const [logicalId, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) {continue;}
        const statements = statementsOfDocument(resource.Properties?.PolicyDocument);

        for (const stmt of statements) {
          const actions      = actionsOf(stmt);
          const resourceList = resourcesOf(stmt);

          for (const action of actions) {
            if (!scopedWriteActions.has(action)) {continue;}
            sawAnyScopedAction = true;
            if (resourceList.includes('*')) {
              violations.push(`${logicalId}: ${action} granted on bare Resource "*" (expected deterministic name-pattern scoping)`);
            }
          }
        }
      }

      expect(sawAnyScopedAction).toBe(true);
      expect(violations).toEqual([]);
    });
  });

  /**
   * PITR Configuration Tests
   */
  describe('PITR Configuration', () => {
    it('data stack (non-dev): all five data tables have PITR enabled', () => {
      const app   = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      const tableResources = Object.values(resources).filter((r) => isResourceOfType(r, 'AWS::DynamoDB::Table'));

      // Verify we have at least 5 tables (the data tables)
      expect(tableResources.length).toBeGreaterThanOrEqual(5);

      // Check PITR for each table
      for (const table of tableResources) {
        const props    = table.Properties as Record<string, unknown>;
        const pitrSpec = props.PointInTimeRecoverySpecification as Record<string, unknown> | undefined;

        // All tables in non-dev mode should have PITR enabled
        // (In prod/non-dev, all five data tables have PITR enabled)
        const pitrEnabled = pitrSpec?.PointInTimeRecoveryEnabled as boolean | undefined;
        expect(pitrEnabled).toBe(true);
      }
    });
  });

  /**
   * S3 Lifecycle Rule Configuration Tests
   */
  describe('S3 Lifecycle Rule Configuration', () => {
    it('data stack: DeleteUploadedBlobs rule uses prefix filter for uploads/', () => {
      const app   = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      // Find the S3 bucket and verify lifecycle rules
      let foundBucket = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::S3::Bucket')) {continue;}
        foundBucket = true;

        const props           = resource.Properties as Record<string, unknown>;
        const lifecycleConfig = props.LifecycleConfiguration as Record<string, unknown> | undefined;
        const lifecycleRules  = lifecycleConfig?.Rules as Array<Record<string, unknown>> | undefined;
        expect(lifecycleRules).toBeDefined();
        expect(Array.isArray(lifecycleRules)).toBe(true);

        // Find DeleteUploadedBlobs rule
        const uploadRule = lifecycleRules?.find((rule) => rule.Id === 'DeleteUploadedBlobs');
        expect(uploadRule).toBeDefined();
        expect(uploadRule?.Status).toEqual('Enabled');

        // Verify prefix filter exists and is 'uploads/'
        expect(uploadRule?.Prefix).toEqual('uploads/');

        // Verify NO tag filters (should be undefined)
        const tagFilters = uploadRule?.TagFilters as Array<Record<string, string>> | undefined;
        expect(tagFilters).toBeUndefined();

        // Verify expiration is 1 day
        expect(uploadRule?.ExpirationInDays).toEqual(1);
      }

      expect(foundBucket).toBe(true);
    });

    it('data stack: incoming-emails rule still uses prefix filter', () => {
      const app   = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env:         { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      // Find the S3 bucket and verify incoming-emails rule
      let foundRule = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::S3::Bucket')) {continue;}

        const props           = resource.Properties as Record<string, unknown>;
        const lifecycleConfig = props.LifecycleConfiguration as Record<string, unknown> | undefined;
        const lifecycleRules  = lifecycleConfig?.Rules as Array<Record<string, unknown>> | undefined;

        const incomingRule = lifecycleRules?.find((rule) => rule.Id === 'DeleteUnhandledIncomingEmails');
        if (!incomingRule) {continue;}

        foundRule = true;
        expect(incomingRule.Status).toEqual('Enabled');

        // Verify prefix filter exists and is 'incoming-emails/'
        expect(incomingRule.Prefix).toEqual('incoming-emails/');

        // Verify expiration is 7 days
        expect(incomingRule.ExpirationInDays).toEqual(7);
      }

      expect(foundRule).toBe(true);
    });
  });

});
