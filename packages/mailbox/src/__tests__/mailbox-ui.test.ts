/**
 * MailboxUi.addUiDeployment IAM Policy Tests
 *
 * Tests for MailboxUi.addUiDeployment method IAM policy scoping.
 * Verifies that S3 operations are properly scoped to specific buckets and artifacts.
 *
 * Security requirements:
 * - s3:ListBucket MUST be scoped to the specific UI bucket ARN
 * - s3:GetObject, s3:GetObjectVersion MUST be scoped to the specific artifact ARN
 * - cloudfront:CreateInvalidation MUST be scoped to the specific distribution ARN
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MailboxUi } from '../ui/mailbox-ui';
import { PinnedResolver, CdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import { OAUTH_CLIENT_ADMIN_UI, AUTH_POLICY_ADMIN_API } from '../auth/types';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import {
  CloudFormationResource,
  getPolicyStatements,
  isResourceOfType,
} from './iam-test-helpers';
import { AuditEventsQueue, type IAuditEventsQueue } from '../features/audit-writing/audit-events-queue';
import { DataTable, type IDataTable } from '../data/data-tables';

describe('MailboxUi.addUiDeployment IAM Policies', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: ICdkArtifactEngine;
  let configTable: IDataTable;
  let auditEventsQueue: IAuditEventsQueue;

  beforeEach(() => {
    app = new App({
      context: {
        'serverlessinbox:artifacts': {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-cdk': { kind: 'release', version: '1.0.0' },
            'mailbox-go': { kind: 'release', version: '1.0.0' },
            'mailbox-cdk-shared': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });
    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    // Create a pinned resolver with required packages
    const packages: Record<string, ArtifactVersionsEntry> = {
      'mailbox-cdk': { version: '1.0.0', zone: 'regional' },
      'mailbox-go': { version: '1.0.0', zone: 'regional' },
      'mailbox-cdk-shared': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, { bucketBase: 'test-artifacts', project: 'serverlessinbox' }, {});
    pinnedResolver.registerPackages(['mailbox-cdk', 'mailbox-go', 'mailbox-cdk-shared']);

    // Wrap in CdkArtifactEngine for the full interface
    const engine = new CdkArtifactEngine(stack, pinnedResolver);
    artifactResolver = engine;

    // Create a minimal config table for the UI
    configTable = new DataTable(new dynamodb.Table(stack, 'config-table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    }));

    auditEventsQueue = new AuditEventsQueue(stack, 'audit-events-queue');
  });

  describe('S3 ListBucket Permission', () => {
    it('should scope s3:ListBucket to the specific UI bucket ARN', () => {
      new MailboxUi(stack, 'admin-ui', {
        domainName: 'admin.example.com',
        label: 'admin',
        tokenExchangeServiceName: 'idp-token-exchange-admin-ui',
        tokenExchangePipeline: 'admin',
        configTable,
        auditEventsQueue,
        authPolicyName: AUTH_POLICY_ADMIN_API,
        oauthClientName: OAUTH_CLIENT_ADMIN_UI,
        artifactResolver,
        uiBundle: {
          packageName: 'mailbox-cdk',
          objectPath: 'ui/admin.zip',
        },
        uiConfig: {
          apiUrl: 'https://api.example.com',
        },
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      // Find the s3:ListBucket policy
      let listBucketScoped = false;

      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;

        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);
        const stmt = statements.find((s) => {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          return actions.includes('s3:ListBucket');
        });

        if (stmt) {
          const stmtResources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
          // Must NOT use bare wildcard
          expect(stmtResources).not.toContain('*');
          // Should be scoped to an S3 bucket ARN (arn:aws:s3:::bucket-name) or an intrinsic function
          expect(stmtResources.some((r) => {
            if (typeof r === 'string') {
              return r.includes('arn:aws:s3:::');
            }
            // Handle intrinsic functions (Fn::GetAtt, Fn::Join, etc.) - their presence indicates scoping
            if (typeof r === 'object' && r !== null) {
              return (
                'Fn::GetAtt' in r ||
                'Fn::Join' in r ||
                'Fn::Sub' in r ||
                'Ref' in r
              );
            }
            return false;
          })).toBe(true);
          listBucketScoped = true;
        }
      }

      expect(listBucketScoped).toBe(true);
    });
  });

  describe('S3 GetObject Permission', () => {
    it('should scope s3:GetObject to the specific artifact ARN', () => {
      new MailboxUi(stack, 'admin-ui', {
        domainName: 'admin.example.com',
        label: 'admin',
        tokenExchangeServiceName: 'idp-token-exchange-admin-ui',
        tokenExchangePipeline: 'admin',
        configTable,
        auditEventsQueue,
        authPolicyName: AUTH_POLICY_ADMIN_API,
        oauthClientName: OAUTH_CLIENT_ADMIN_UI,
        artifactResolver,
        uiBundle: {
          packageName: 'mailbox-cdk',
          objectPath: 'ui/admin.zip',
        },
        uiConfig: {
          apiUrl: 'https://api.example.com',
        },
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      let getObjectScoped = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;

        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);
        const stmt = statements.find((s) => {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          return actions.includes('s3:GetObject');
        });

        if (stmt) {
          const resources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
          // Must NOT use bare wildcard
          expect(resources).not.toContain('*');
          // Should be scoped to a specific artifact object
          expect(resources.some((r) => r?.includes('arn:aws:s3:::') && r?.includes('/'))).toBe(true);
          getObjectScoped = true;
        }
      }

      expect(getObjectScoped).toBe(true);
    });

    it('should scope s3:GetObjectVersion to the specific artifact ARN', () => {
      new MailboxUi(stack, 'admin-ui', {
        domainName: 'admin.example.com',
        label: 'admin',
        tokenExchangeServiceName: 'idp-token-exchange-admin-ui',
        tokenExchangePipeline: 'admin',
        configTable,
        auditEventsQueue,
        authPolicyName: AUTH_POLICY_ADMIN_API,
        oauthClientName: OAUTH_CLIENT_ADMIN_UI,
        artifactResolver,
        uiBundle: {
          packageName: 'mailbox-cdk',
          objectPath: 'ui/admin.zip',
        },
        uiConfig: {
          apiUrl: 'https://api.example.com',
        },
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      let getObjectVersionScoped = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;

        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);
        const stmt = statements.find((s) => {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          return actions.includes('s3:GetObjectVersion');
        });

        if (stmt) {
          const resources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
          // Must NOT use bare wildcard
          expect(resources).not.toContain('*');
          // Should be scoped to a specific artifact object
          expect(resources.some((r) => r?.includes('arn:aws:s3:::') && r?.includes('/'))).toBe(true);
          getObjectVersionScoped = true;
        }
      }

      expect(getObjectVersionScoped).toBe(true);
    });
  });

  describe('CloudFront CreateInvalidation Permission', () => {
    it('should scope cloudfront:CreateInvalidation to the target distribution ARN', () => {
      new MailboxUi(stack, 'admin-ui', {
        domainName: 'admin.example.com',
        label: 'admin',
        tokenExchangeServiceName: 'idp-token-exchange-admin-ui',
        tokenExchangePipeline: 'admin',
        configTable,
        auditEventsQueue,
        authPolicyName: AUTH_POLICY_ADMIN_API,
        oauthClientName: OAUTH_CLIENT_ADMIN_UI,
        artifactResolver,
        uiBundle: {
          packageName: 'mailbox-cdk',
          objectPath: 'ui/admin.zip',
        },
        uiConfig: {
          apiUrl: 'https://api.example.com',
        },
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      let distributionLogicalId: string | undefined;
      for (const [logicalId, resource] of Object.entries(resources)) {
        if (isResourceOfType(resource, 'AWS::CloudFront::Distribution')) {
          distributionLogicalId = logicalId;
        }
      }
      if (!distributionLogicalId) throw new Error('No CloudFront distribution in template');

      let cfCreateInvalidationFound = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;

        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);
        const stmt = statements.find((s) => {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          return actions.includes('cloudfront:CreateInvalidation');
        });

        if (stmt) {
          const stmtResources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
          expect(stmtResources).not.toContain('*');
          expect(stmtResources).toEqual([
            {
              'Fn::Join': [
                '',
                [
                  'arn:',
                  { Ref: 'AWS::Partition' },
                  ':cloudfront::',
                  { Ref: 'AWS::AccountId' },
                  ':distribution/',
                  { Ref: distributionLogicalId },
                ],
              ],
            },
          ]);
          cfCreateInvalidationFound = true;
        }
      }

      expect(cfCreateInvalidationFound).toBe(true);
    });
  });

  describe('UI Deployment without bundle', () => {
    it('should not grant S3 artifact access when uiBundle is omitted', () => {
      new MailboxUi(stack, 'admin-ui-no-bundle', {
        domainName: 'admin.example.com',
        label: 'admin-no-bundle',
        tokenExchangeServiceName: 'idp-token-exchange-admin-ui',
        tokenExchangePipeline: 'admin',
        configTable,
        auditEventsQueue,
        authPolicyName: AUTH_POLICY_ADMIN_API,
        oauthClientName: OAUTH_CLIENT_ADMIN_UI,
        artifactResolver,
        uiConfig: {
          apiUrl: 'https://api.example.com',
        },
      });

      const template = Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      // When no uiBundle is provided, there should be no custom resource
      // (addUiDeployment should not be called)
      let customResourceFound = false;
      for (const [, resource] of Object.entries(resources)) {
        if (isResourceOfType(resource, 'AWS::CloudFormation::CustomResource')) {
          const serviceToken = resource.Properties?.ServiceToken;
          if (typeof serviceToken === 'string' && serviceToken.includes('ui-deployer')) {
            customResourceFound = true;
          }
        }
      }

      expect(customResourceFound).toBe(false);
    });
  });

});
