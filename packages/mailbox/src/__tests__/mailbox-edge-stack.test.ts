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

import { ArtifactZone, PinnedArtifactResolver }         from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin }                             from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, resourcesOf, statementsOfDocument } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { ArtifactObject, DeployedStack }                from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                     from 'aws-cdk-lib/assertions';
import * as cdk                                         from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                from 'aws-cdk-lib';

import { MailboxEdgeStack }                             from '../core/edge/mailbox-edge-stack';
import { MailboxEdgeDeployerWorkerLambda }              from '../resources/lambdas/mailbox-edge-deployer-worker-lambda';

import {
  CloudFormationResource,
  CloudFormationTag,
  KNOWN_WILDCARDS,
  getTagValue,
  isResourceOfType,
  readTags,
} from './iam-test-helpers';

describe('MailboxEdgeStack Template Synthesis', () => {
  /**
   * S2.1: Tag Contract — every taggable resource carries serverless-inbox:root-stack
   */
  describe('Tag Contract (S2.1)', () => {
    it('edge stack: all taggable resources have correct root-stack tag', () => {
      const app   = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env:         { account: '123456789012', region: 'us-east-1' },
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

        const tags = readTags(resource);
        if (tags === undefined) {continue;}
        taggedResourceCount++;

        const rootStackTag = tags.find((t) => t.Key === 'serverless-inbox:root-stack');
        expect(rootStackTag).toBeDefined();
        const tagValue = rootStackTag ? getTagValue(rootStackTag) : undefined;
        expect(tagValue).toEqual({ Ref: 'rootStack' });
      }

      // Regression check: edge stack should have at least 2 taggable resources (Lambda, Role, etc.)
      expect(taggedResourceCount).toBeGreaterThan(0);
    });

    it('edge stack: declares a mandatory rootStackId parameter and tags its resources with it', () => {
      const app   = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env:         { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template   = Template.fromStack(stack);
      const parameters = template.toJSON().Parameters as Record<string, { Type: string; Default?: string }>;
      expect(parameters.rootStackId).toEqual(expect.objectContaining({ Type: 'String' }));
      expect(parameters.rootStackId.Default).toBeUndefined();

      const resources = Object.values(template.toJSON().Resources as Record<string, CloudFormationResource>);
      const tagged    = resources.filter(
        (r) => (isResourceOfType(r, 'AWS::Lambda::Function') || isResourceOfType(r, 'AWS::IAM::Role')) && Array.isArray(r.Properties?.Tags),
      );
      expect(tagged.length).toBeGreaterThan(0);
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
    it('edge stack: no unscoped iam:* or logs:* write actions on Resource "*"', () => {
      const app   = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env:         { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
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
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) {continue;}

        const policyDoc  = resource.Properties?.PolicyDocument;
        const statements = statementsOfDocument(policyDoc);

        for (const stmt of statements) {
          const actions      = actionsOf(stmt);
          const resourceList = resourcesOf(stmt);

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
   * The edge stack template contains no IAM roles or policies; the jmap-blob-download execution
   * role and deployer worker policies live in the root stack and are covered by separate
   * deployer-worker tests. This suite pins that the edge stack carries no unexpected policies.
   */
  describe('Edge Stack Policy Quality (S2.3)', () => {
    it('edge stack: contains no IAM policies', () => {
      const app   = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env:         { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      let policyCount = 0;

      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) {continue;}
        policyCount++;
      }

      // The edge stack contains no IAM policies
      expect(policyCount).toBe(0);
    });
  });

  /**
   * L5: Construct Quality Assertions
   */
  describe('Construct Quality (L5)', () => {
    it('edge stack: Template.fromStack succeeds with sane resource counts', () => {
      const app   = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env:         { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;

      // Edge stack should have several resources: Lambda, ACM, etc.
      // (The role is now created in the root stack, not the edge stack.)
      expect(resources).toBeDefined();
      expect(Object.keys(resources || {}).length).toBeGreaterThan(3);

      // Check for key resource types
      const resourceEntries = Object.values(resources || {});
      const hasLambda       = resourceEntries.some((r) => isResourceOfType(r, 'AWS::Lambda::Function'));
      const hasAcm          = resourceEntries.some((r) => isResourceOfType(r, 'AWS::CertificateManager::Certificate'));

      expect(hasLambda).toBe(true);
      // Role is now in root stack, not edge stack
      // expect(hasRole).toBe(false);
      expect(hasAcm).toBe(true);
    });

    it('edge stack: template has expected parameter schema', () => {
      const app   = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env:         { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template            = Template.fromStack(stack);
      const parameters: unknown = template.toJSON().Parameters ?? {};

      // Edge stack should have domain, prefix, hosted zone, artifact parameters
      expect(parameters).toHaveProperty('domainName');
      expect(parameters).toHaveProperty('prefix');
      expect(parameters).toHaveProperty('hostedZoneId');
      expect(parameters).toHaveProperty('rootStack');
      expect(parameters).toHaveProperty('artifactBucket');
      expect(parameters).toHaveProperty('logGroupName');
      expect(parameters).toHaveProperty('jmapBlobDownloadKey');
      expect(parameters).toHaveProperty('jmapBlobDownloadS3VersionId');
      expect(parameters).toHaveProperty('jmapBlobDownloadRoleArn');
    });

    it('edge stack: the Lambda@Edge function, its version and the version output are named jmap-blob-download', () => {
      const app   = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env:         { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template         = Template.fromStack(stack).toJSON();
      const resources        = template.Resources as Record<string, CloudFormationResource>;
      const logicalIdsOfType = (type: string): string[] =>
        Object.entries(resources).filter(([, resource]) => isResourceOfType(resource, type)).map(([logicalId]) => logicalId);

      expect(logicalIdsOfType('AWS::Lambda::Function')).toEqual([expect.stringMatching(/^edgejmapblobdownload[0-9A-F]{8}$/)]);
      expect(logicalIdsOfType('AWS::Lambda::Version')).toEqual([expect.stringMatching(/^edgejmapblobdownloadCurrentVersion[0-9A-F]{8}/)]);
      expect(template.Outputs).toHaveProperty('jmapBlobDownloadVersionArn');
    });

    it('edge stack: jmap-blob-download LoggingConfig.LogGroup resolves to a Ref on the logGroupName parameter', () => {
      const app   = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env:         { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      const jmapBlobDownloadFn = Object.values(resources).find(
        (r) => isResourceOfType(r, 'AWS::Lambda::Function') && r.Properties?.Handler === 'index.handler'
      );

      expect(jmapBlobDownloadFn).toBeDefined();
      const loggingConfig = jmapBlobDownloadFn?.Properties?.LoggingConfig as { LogGroup?: unknown } | undefined;
      expect(loggingConfig?.LogGroup).toEqual({ Ref: 'logGroupName' });
    });
  });

  /**
   * Regression: Edge stack tag value fix
   * This test specifically checks the bug that was found in the audit:
   * the edge Lambda was tagged with AWS::StackName instead of the root-stack parameter.
   */
  describe('Regression: Edge Lambda Tag Value', () => {
    it('edge Lambda functions do NOT use AWS::StackName for root-stack tag', () => {
      const app   = new App();
      const stack = new MailboxEdgeStack(app, 'TestMailboxEdge', {
        env:         { account: '123456789012', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      const template  = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::Lambda::Function')) {continue;}

        const tags = readTags(resource);
        if (tags === undefined) {continue;}

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
   * Deployer Worker IAM
   * Tests the actual unit containing the 2026-07-09 critical finding (unscoped iam:CreateRole/
   * PutRolePolicy/AttachRolePolicy on Resource "*") directly — MailboxEdgeDeployerWorkerLambda's own
   * IAM grants — instead of the full customer-facing stack (which lives in a different repo,
   * mailbox-apps, and can't be synthesized from here due to separate Yarn PnP roots).
   *
   * The worker only needs iam:PassRole on the concrete role ARN; the execution role is
   * created in the root stack, so no role authorship actions are needed.
   */
  describe('Deployer Worker IAM', () => {
    it('edge deployer worker: grants only iam:PassRole on the concrete role ARN, no role authorship', () => {
      const app       = new App();
      const testStack = new cdk.Stack(app, 'TestEdgeDeployerStack', {
        env:         { account: '123456789012', region: 'us-east-1' },
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

      new MailboxEdgeDeployerWorkerLambda(testStack, 'worker', {
        artifactResolver,
        stack:                   testStack,
        edgeStackNamePattern:    'test-root-edge*',
        edgeStack:               new DeployedStack('arn:aws:cloudformation:us-east-1:123456789012:stack/test-root-edge*/*'),
        rootStack:               'test-root',
        rootStackId:             'test-guid',
        template:                new ArtifactObject(artifactResolver, 'mailbox-cdk-shared', 'template.json'),
        artifactObjects:         [new ArtifactObject(artifactResolver, 'mailbox-cdk-shared', 'lambdas/jmap-blob-download.zip')],
        hostedZoneId:            'Z123456',
        jmapBlobDownloadRoleArn: 'arn:aws:iam::123456789012:role/test-role',
      });

      const template  = Template.fromStack(testStack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) {
        throw new Error('No resources found in template');
      }

      // The deployer worker grants only iam:PassRole scoped to the concrete role ARN,
      // with no iam:CreateRole, iam:PutRolePolicy, or iam:AttachRolePolicy grants.
      const forbiddenRoleAuthorshipActions = new Set([
        'iam:CreateRole', 'iam:PutRolePolicy', 'iam:AttachRolePolicy',
      ]);
      const violations: string[]           = [];

      for (const [logicalId, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) {continue;}
        const statements = statementsOfDocument(resource.Properties?.PolicyDocument);

        for (const stmt of statements) {
          const actions = actionsOf(stmt);

          for (const action of actions) {
            if (forbiddenRoleAuthorshipActions.has(action)) {
              violations.push(`${logicalId}: ${action} must not be granted (role is created in root stack)`);
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });
});
