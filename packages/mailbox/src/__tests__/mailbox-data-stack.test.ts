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

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MailboxDataStack } from '../data/mailbox-data-stack';
import {
  CloudFormationTag,
  CloudFormationPolicyStatement,
  CloudFormationPolicyDocument,
  CloudFormationResource,
  KNOWN_WILDCARDS,
  getTagValue,
  isResourceOfType,
  getPolicyStatements,
} from './iam-test-helpers';

describe('MailboxDataStack Template Synthesis', () => {
  /**
   * S2.1: Tag Contract — every taggable resource carries serverless-inbox:root-stack
   */
  describe('Tag Contract (S2.1)', () => {
    it('data stack: all taggable resources have correct root-stack tag', () => {
      const app = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      let taggedResourceCount = 0;
      for (const [, resource] of Object.entries(resources)) {
        const isTable = isResourceOfType(resource, 'AWS::DynamoDB::Table');
        const isBucket = isResourceOfType(resource, 'AWS::S3::Bucket');
        if (!isTable && !isBucket) continue;

        const tags = resource.Properties?.Tags;
        if (!Array.isArray(tags)) continue;
        taggedResourceCount++;

        const rootStackTag = tags.find((t) => t.Key === 'serverless-inbox:root-stack');
        expect(rootStackTag).toBeDefined();
        const tagValue = rootStackTag ? getTagValue(rootStackTag) : undefined;
        expect(tagValue).toEqual({ Ref: 'rootStack' });
      }

      // Data stack should have multiple DynamoDB tables and S3 buckets
      expect(taggedResourceCount).toBeGreaterThan(2);
    });
  });

  /**
   * S2.2: IAM Wildcard Guard - no iam or logs write actions on Resource * without Condition
   */
  describe('IAM Wildcard Guard (S2.2)', () => {
    it('data stack: no unscoped iam:* or logs:* write actions on Resource "*"', () => {
      const app = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
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
        'logs:CreateLogGroup',
        'logs:DeleteLogGroup',
        'logs:CreateLogStream',
        'logs:DeleteLogStream',
        'logs:PutLogEvents',
      ]);

      const violations: string[] = [];

      for (const [logicalId, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;

        const policyDoc = resource.Properties?.PolicyDocument;
        const statements = getPolicyStatements(policyDoc);

        for (const stmt of statements) {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          const resourceList = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];

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
      const app = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;

      // Data stack should have multiple DynamoDB tables and S3 buckets
      const resourceEntries = Object.values(resources || {});
      const tableCount = resourceEntries.filter((r) => isResourceOfType(r, 'AWS::DynamoDB::Table')).length;
      const bucketCount = resourceEntries.filter((r) => isResourceOfType(r, 'AWS::S3::Bucket')).length;

      expect(tableCount).toBeGreaterThanOrEqual(4); // At least 4 data tables expected
      expect(bucketCount).toBeGreaterThanOrEqual(1); // At least 1 blob store bucket
    });

    it('data stack: S3 buckets exist in template', () => {
      const app = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      // Verify S3 buckets exist in the template
      const buckets = Object.values(resources).filter((r) => isResourceOfType(r, 'AWS::S3::Bucket'));
      expect(buckets.length).toBeGreaterThanOrEqual(1);

      // Verify at least one bucket has proper configurations
      for (const bucket of buckets) {
        if (!isResourceOfType(bucket, 'AWS::S3::Bucket')) continue;
        // Buckets should exist with some configuration (versioning, encryption, etc.)
        expect(bucket.Properties).toBeDefined();
      }
    });

    it('data stack: template has expected parameter schema', () => {
      const app = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const parameters = template.toJSON().Parameters || {};

      // Data stack should have root stack correlation parameters
      expect(parameters).toHaveProperty('rootStack');
      expect(parameters).toHaveProperty('s3NameBase');
      expect(parameters).toHaveProperty('productVersion');
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
      const app = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
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
      // Bug caught: if PublicAccessBlockConfiguration was removed, BlockPublicAccess.BLOCK_ALL would be missing,
      // and this test would fail (previously would pass because only checked if props existed)
      expect(bucketWithBlocksCount).toBeGreaterThan(0);
    });

    /**
     * DynamoDB Table Configuration Verification
     */
    it('data stack: DynamoDB tables are retained on delete/update (not accidentally destroyable)', () => {
      const app = new App();
      const stack = new MailboxDataStack(app, 'TestMailboxData', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource & { DeletionPolicy?: string; UpdateReplacePolicy?: string }> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      let tableCount = 0;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::DynamoDB::Table')) continue;
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
   * Deployer Grant Functions
   * Tests the data deployer worker permissions directly — grantDataDeployerWorkerPermissions
   * instead of the full customer-facing stack (which lives in a different repo, mailbox-apps,
   * and can't be synthesized from here due to separate Yarn PnP roots).
   */
  describe('Deployer Grant Functions', () => {
    it('data deployer grants: DynamoDB/S3 write actions are scoped to the deterministic resource-name pattern, never Resource "*"', () => {
      const app = new App();
      const testStack = new cdk.Stack(app, 'TestDataDeployerStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const { grantDataDeployerWorkerPermissions } = require('../data/mailbox-data-deployer-grants');

      const testLambda = new cdk.aws_lambda.Function(testStack, 'test-lambda', {
        runtime: cdk.aws_lambda.Runtime.NODEJS_24_X,
        handler: 'index.handler',
        code: cdk.aws_lambda.Code.fromInline('exports.handler = async () => {}'),
      });

      grantDataDeployerWorkerPermissions(testLambda, {
        stack: testStack,
        dataStackArn: 'arn:aws:cloudformation:us-west-2:123456789012:stack/test-root-data/*',
        dataStackName: 'test-root-data',
        templateObjectArn: 'arn:aws:s3:::bucket/template.json',
      });

      const template = Template.fromStack(testStack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      const scopedWriteActions = new Set([
        'dynamodb:CreateTable', 'dynamodb:DeleteTable', 'dynamodb:UpdateTable',
        's3:CreateBucket', 's3:DeleteBucket', 's3:PutBucketPolicy',
      ]);
      const violations: string[] = [];
      let sawAnyScopedAction = false;

      for (const [logicalId, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);

        for (const stmt of statements) {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          const resourceList = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];

          for (const action of actions) {
            if (!scopedWriteActions.has(action)) continue;
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
});
