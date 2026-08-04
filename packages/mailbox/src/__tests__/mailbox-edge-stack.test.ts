/**
 * MailboxEdgeStack Template Synthesis Tests
 *
 * Tests for synthesized CloudFormation templates from MailboxEdgeStack.
 * Verifies: tag contracts, IAM wildcard guards, deployer policy shapes, and construct quality.
 *
 * Security audit findings (2026-07-09):
 * - S2 regression: Edge Lambda carried wrong tag value (AWS::StackName instead of rootStack) breaking sweeper ownership
 * - S2 critical: Edge deployer granted unscoped iam:* and logs:* write actions on Resource "*"
 * These tests lock in the fixes and catch regressions.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MailboxEdgeStack } from '../edge/mailbox-edge-stack';
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

describe('MailboxEdgeStack Template Synthesis', () => {
  /**
   * S2.1: Tag Contract — every taggable resource carries serverless-inbox:root-stack
   */
  describe('Tag Contract (S2.1)', () => {
    it('edge stack: all taggable resources have correct root-stack tag', () => {
      const app = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env: { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);

      // Taggable resource types in edge stack: Lambda, IAM Role, CloudFront Distribution, ACM Certificate, etc.
      // Each should have serverless-inbox:root-stack = {"Ref":"rootStack"}, NOT {"Ref":"AWS::StackName"}
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      let taggedResourceCount = 0;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::Lambda::Function') && !isResourceOfType(resource, 'AWS::IAM::Role') && !isResourceOfType(resource, 'AWS::CertificateManager::Certificate')) {
          continue;
        }

        const tags = resource.Properties?.Tags;
        if (!Array.isArray(tags)) continue;
        taggedResourceCount++;

        const rootStackTag = tags.find((t) => t.Key === 'serverless-inbox:root-stack');
        expect(rootStackTag).toBeDefined();
        const tagValue = rootStackTag ? getTagValue(rootStackTag) : undefined;
        expect(tagValue).toEqual({ Ref: 'rootStack' });
      }

      // Regression check: edge stack should have at least 2 taggable resources (Lambda, Role, etc.)
      expect(taggedResourceCount).toBeGreaterThan(0);
    });
  });

  /**
   * S2.2: IAM Wildcard Guard - no iam or logs write actions on Resource * without Condition
   */
  describe('IAM Wildcard Guard (S2.2)', () => {
    it('edge stack: no unscoped iam:* or logs:* write actions on Resource "*"', () => {
      const app = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env: { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      const writeActions = new Set([
        // IAM write actions
        'iam:CreateRole',
        'iam:DeleteRole',
        'iam:PutRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:TagRole',
        'iam:UntagRole',
        'iam:PassRole',
        // CloudWatch Logs write actions
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
        const statements = getPolicyStatements(policyDoc);

        for (const stmt of statements) {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          const resourceList = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];

          // Check if any write action is on "*" without a condition
          for (const action of actions) {
            if (writeActions.has(action) && resourceList.includes('*') && !stmt.Condition) {
              // Check if this is in the known allowlist
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
   * S2.3: Edge Stack Policy Quality — verify policies follow least-privilege pattern
   *
   * NOTE: SweeperInfra is NOT part of MailboxEdgeStack (it's in the root Mailbox construct).
   * See sweeper-infra.test.ts for sweeper-specific policy validation.
   * This test verifies the edge stack's own policies are properly scoped.
   */
  describe('Edge Stack Policy Quality (S2.3)', () => {
    it('edge stack: all IAM policies follow least-privilege pattern with scoping', () => {
      const app = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env: { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      let policyCount = 0;
      const unscopedStatements: string[] = [];

      for (const [logicalId, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;

        policyCount++;
        const policyDoc = resource.Properties?.PolicyDocument;
        const statements = getPolicyStatements(policyDoc);

        // Verify each statement has scoping (condition or limited resource)
        for (const stmt of statements) {
          const stmtResources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
          const stmtActions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];

          // Resource is unscoped if it only contains "*" AND has no conditions
          const isUnscoped = stmtResources.every((r) => r === '*') && !stmt.Condition;

          // Allow known unscoped read operations (e.g., CloudFormation reads)
          const isSafeRead = stmtActions.every((a) => {
            const action = typeof a === 'string' ? a : '';
            return action.includes('Describe') ||
                   action.includes('Get') ||
                   action === 'cloudformation:GetTemplateSummary' ||
                   KNOWN_WILDCARDS[action];
          });

          if (isUnscoped && !isSafeRead) {
            unscopedStatements.push(
              `${logicalId}: ${stmtActions.join(', ')} on Resource "*" without condition or scope`
            );
          }
        }
      }

      // Edge stack should have IAM policies
      expect(policyCount).toBeGreaterThan(0);
      // Verify no dangerous unscoped write actions
      expect(unscopedStatements).toEqual([]);
    });
  });

  /**
   * L5: Construct Quality Assertions
   */
  describe('Construct Quality (L5)', () => {
    it('edge stack: Template.fromStack succeeds with sane resource counts', () => {
      const app = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env: { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;

      // Edge stack should have several resources: Lambda, Role, ACM, CloudFront, etc.
      expect(resources).toBeDefined();
      expect(Object.keys(resources || {}).length).toBeGreaterThan(3);

      // Check for key resource types
      const resourceEntries = Object.values(resources || {});
      const hasLambda = resourceEntries.some((r) => isResourceOfType(r, 'AWS::Lambda::Function'));
      const hasRole = resourceEntries.some((r) => isResourceOfType(r, 'AWS::IAM::Role'));
      const hasAcm = resourceEntries.some((r) => isResourceOfType(r, 'AWS::CertificateManager::Certificate'));

      expect(hasLambda).toBe(true);
      expect(hasRole).toBe(true);
      expect(hasAcm).toBe(true);
    });

    it('edge stack: template has expected parameter schema', () => {
      const app = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env: { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const parameters = template.toJSON().Parameters || {};

      // Edge stack should have domain, prefix, hosted zone, artifact parameters
      expect(parameters).toHaveProperty('domainName');
      expect(parameters).toHaveProperty('prefix');
      expect(parameters).toHaveProperty('hostedZoneId');
      expect(parameters).toHaveProperty('rootStack');
      expect(parameters).toHaveProperty('artifactBucket');
    });
  });

  /**
   * Regression: Edge stack tag value fix
   * This test specifically checks the bug that was found in the audit:
   * the edge Lambda was tagged with AWS::StackName instead of the root-stack parameter.
   */
  describe('Regression: Edge Lambda Tag Value', () => {
    it('edge Lambda functions do NOT use AWS::StackName for root-stack tag', () => {
      const app = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env: { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::Lambda::Function')) continue;

        const tags = resource.Properties?.Tags;
        if (!Array.isArray(tags)) continue;

        const rootStackTag = tags.find((t) => t.Key === 'serverless-inbox:root-stack');

        if (rootStackTag) {
          const tagValue = getTagValue(rootStackTag);
          // Verify the tag value is NOT a reference to AWS::StackName
          if (
            typeof tagValue === 'object' &&
            'Ref' in tagValue &&
            tagValue.Ref === 'AWS::StackName'
          ) {
            throw new Error(
              'Regression detected! root-stack tag uses AWS::StackName instead of rootStack parameter'
            );
          }

          // Verify it's the correct parameter reference
          expect(tagValue).toEqual({ Ref: 'rootStack' });
        }
      }
    });
  });

  /**
   * Deployer Grant Functions
   * Tests the actual unit containing the 2026-07-09 critical finding (unscoped iam:CreateRole/
   * PutRolePolicy/AttachRolePolicy on Resource "*") directly — grantEdgeDeployerWorkerPermissions
   * instead of the full customer-facing stack (which lives in a different repo, mailbox-apps,
   * and can't be synthesized from here due to separate Yarn PnP roots).
   */
  describe('Deployer Grant Functions', () => {
    it('edge deployer grants: IAM role-lifecycle actions are scoped by role-path, never Resource "*"', () => {
      const app = new App();
      const testStack = new cdk.Stack(app, 'TestEdgeDeployerStack', {
        env: { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const { grantEdgeDeployerWorkerPermissions } = require('../edge/mailbox-edge-deployer-grants');

      const testLambda = new cdk.aws_lambda.Function(testStack, 'test-lambda', {
        runtime: cdk.aws_lambda.Runtime.NODEJS_24_X,
        handler: 'index.handler',
        code: cdk.aws_lambda.Code.fromInline('exports.handler = async () => {}'),
      });

      grantEdgeDeployerWorkerPermissions(testLambda, {
        stack: testStack,
        edgeStackName: 'test-root-edge',
        edgeStackArn: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-root-edge/*',
        rootStack: 'test-root',
        templateObjectArn: 'arn:aws:s3:::bucket/template.json',
        artifactObjectArns: ['arn:aws:s3:::bucket/lambdas/blob-authorizer.zip'],
        hostedZoneId: 'Z123456',
      });

      const template = Template.fromStack(testStack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      // THE regression check: the audit's critical finding was iam:CreateRole/PutRolePolicy/
      // AttachRolePolicy/etc. granted on Resource "*" with no Condition. Assert every IAM
      // role-lifecycle write action is scoped to a role ARN pattern, never the bare wildcard "*".
      const iamRoleWriteActions = new Set([
        'iam:CreateRole', 'iam:DeleteRole', 'iam:PutRolePolicy', 'iam:DeleteRolePolicy',
        'iam:AttachRolePolicy', 'iam:DetachRolePolicy', 'iam:TagRole', 'iam:UntagRole',
      ]);
      const violations: string[] = [];
      let sawAnyIamRoleAction = false;

      for (const [logicalId, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);

        for (const stmt of statements) {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          const resourceList = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];

          for (const action of actions) {
            if (!iamRoleWriteActions.has(action)) continue;
            sawAnyIamRoleAction = true;
            if (resourceList.includes('*')) {
              violations.push(`${logicalId}: ${action} granted on bare Resource "*" (expected role-path scoping)`);
            }
          }
        }
      }

      expect(sawAnyIamRoleAction).toBe(true); // sanity: the grant function actually ran
      expect(violations).toEqual([]);
    });
  });
});
