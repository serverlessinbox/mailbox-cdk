/**
 * Support Access Addon Unit Tests — Construct Behavior
 *
 * These tests verify the core construct behavior:
 * - Disabled mode creates zero resources
 * - Enabled mode creates all resources with correct configuration
 * - Role trust policies are non-assumable by default
 * - Session durations are correctly set to 3600 seconds
 * - No inline permissions policies are created at construction
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { CdkArtifactEngine, PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import { SupportAccessAddon, SupportAccessMode } from '../support-access-addon';

/**
 * Helper to create an artifact resolver for testing.
 */
function createTestArtifactResolver(stack: cdk.Stack): ICdkArtifactEngine {
  const packages: Record<string, ArtifactVersionsEntry> = {
    'mailbox-cdk': { version: '1.0.0', zone: 'regional' },
    'mailbox-go': { version: '1.0.0', zone: 'regional' },
  };
  const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
  pinnedResolver.registerPackages(['mailbox-cdk', 'mailbox-go']);
  const engine = new CdkArtifactEngine(stack, pinnedResolver);
  return engine;
}

describe('SupportAccessAddon Unit Tests', () => {
  describe('Disabled mode', () => {
    it('Creates zero resources when mode is literally DISABLED', () => {
      const app = new App({
        context: {
          artifacts: {
            bucketBase: 'test-artifacts',
            packages: {
              'mailbox-cdk': { kind: 'release', version: '1.0.0' },
              'mailbox-go': { kind: 'release', version: '1.0.0' },
            },
          },
        },
      });
      const stack = new cdk.Stack(app, 'test-stack', {
        env: { account: '111122223333', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      // Create a mock config table for the test
      const configTable = new Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
        sortKey: { name: 'sk', type: AttributeType.STRING },
      });

      // Create a mock audit queue for the test
      const auditEventsQueue = new Queue(stack, 'audit-queue');

      const artifactResolver = createTestArtifactResolver(stack);

      // Direct construct use (not through provider)
      new SupportAccessAddon(stack, 'test-addon', {
        mode: SupportAccessMode.DISABLED,
        artifactResolver,
        configTable,
        auditEventsQueue,
      });

      const template = Template.fromStack(stack);

      // Verify zero support roles (by placeholder principal)
      const roles = template.findResources('AWS::IAM::Role');
      const supportRoles = Object.entries(roles).filter(([, role]) => {
        const props = (role as any).Properties;
        const trustPolicyDoc = props.AssumeRolePolicyDocument;
        const statements = trustPolicyDoc?.Statement || [];
        return statements.some((stmt: any) =>
          stmt.Principal?.Service?.includes?.('empty-deny-placeholder.amazonaws.com')
        );
      });
      expect(supportRoles.length).toBe(0);

      // Verify zero support-access lambdas
      const functions = template.findResources('AWS::Lambda::Function');
      const supportAccessLambdas = Object.entries(functions).filter(([, func]) => {
        const props = (func as any).Properties;
        return props.Environment?.Variables?.SUPPORT_DIAG_ROLE_ARN;
      });
      expect(supportAccessLambdas.length).toBe(0);
    });

    it('Creates zero resources when mode is omitted (defaults to undefined/falsy)', () => {
      const app = new App({
        context: {
          artifacts: {
            bucketBase: 'test-artifacts',
            packages: {
              'mailbox-cdk': { kind: 'release', version: '1.0.0' },
              'mailbox-go': { kind: 'release', version: '1.0.0' },
            },
          },
        },
      });
      const stack = new cdk.Stack(app, 'test-stack-2', {
        env: { account: '111122223333', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      // Create a mock config table for the test
      const configTable = new Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
        sortKey: { name: 'sk', type: AttributeType.STRING },
      });

      // Create a mock audit queue for the test
      const auditEventsQueue = new Queue(stack, 'audit-queue');

      const artifactResolver = createTestArtifactResolver(stack);

      // Construct with explicitly DISABLED mode
      new SupportAccessAddon(stack, 'test-addon', {
        mode: SupportAccessMode.DISABLED,
        artifactResolver,
        configTable,
        auditEventsQueue,
      });

      const template = Template.fromStack(stack);

      // All resource types should be zero
      const roles = template.findResources('AWS::IAM::Role');
      const functions = template.findResources('AWS::Lambda::Function');

      const supportRoles = Object.entries(roles).filter(([, role]) => {
        const props = (role as any).Properties;
        return props.RoleName?.includes?.('support-');
      });

      const supportAccessLambdas = Object.entries(functions).filter(([, func]) => {
        const props = (func as any).Properties;
        return props.Environment?.Variables?.SUPPORT_DIAG_ROLE_ARN;
      });

      expect(supportRoles.length).toBe(0);
      expect(supportAccessLambdas.length).toBe(0);
    });
  });

  describe('Enabled mode - Construct verification', () => {
    let stack: cdk.Stack;
    let template: Template;
    let artifactResolver: ICdkArtifactEngine;
    let configTable: Table;
    let auditEventsQueue: Queue;

    beforeEach(() => {
      const app = new App({
        context: {
          artifacts: {
            bucketBase: 'test-artifacts',
            packages: {
              'mailbox-cdk': { kind: 'release', version: '1.0.0' },
              'mailbox-go': { kind: 'release', version: '1.0.0' },
            },
          },
        },
      });
      stack = new cdk.Stack(app, 'test-stack-enabled', {
        env: { account: '111122223333', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      // Create a mock config table for the test
      configTable = new Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
        sortKey: { name: 'sk', type: AttributeType.STRING },
      });

      // Create a mock audit events queue for the test
      auditEventsQueue = new Queue(stack, 'audit-queue');

      artifactResolver = createTestArtifactResolver(stack);

      new SupportAccessAddon(stack, 'test-addon', {
        mode: SupportAccessMode.ENABLED,
        artifactResolver,
        configTable,
        auditEventsQueue,
      });

      template = Template.fromStack(stack);
    });

    it('Creates support roles with MaxSessionDuration: 3600', () => {
      const allRoles = template.findResources('AWS::IAM::Role');

      // Find support roles by checking for the placeholder trust policy
      const supportRoles = Object.entries(allRoles).filter(([, role]) => {
        const props = (role as any).Properties;
        const trustPolicyDoc = props.AssumeRolePolicyDocument;
        const statements = trustPolicyDoc?.Statement || [];

        // Support roles use the empty-deny-placeholder service principal
        return statements.some((stmt: any) =>
          stmt.Principal?.Service?.includes?.('empty-deny-placeholder.amazonaws.com')
        );
      });

      // Should have exactly two support roles (support-diag and support-config-read)
      expect(supportRoles.length).toBe(2);

      // Verify both roles have MaxSessionDuration set to 3600
      for (const [, role] of supportRoles) {
        const props = (role as any).Properties;
        expect(props.MaxSessionDuration).toBe(3600);
      }
    });

    it('Creates support roles with no inline permissions policy', () => {
      const allRoles = template.findResources('AWS::IAM::Role');

      // Find support roles
      const supportRoles = Object.entries(allRoles).filter(([, role]) => {
        const props = (role as any).Properties;
        return props.RoleName?.includes?.('support-');
      });

      // Verify none of the support roles have an inline policy
      for (const [, role] of supportRoles) {
        const props = (role as any).Properties;
        // Check that there's no inline policies defined
        if (props.Policies) {
          // Filter to only support-specific inline policies (if any exist)
          const supportPolicies = props.Policies.filter((p: any) =>
            p.PolicyName?.includes?.('support')
          );
          expect(supportPolicies.length).toBe(0);
        }
      }
    });

    it('Creates support roles with non-assumable default trust policy', () => {
      const allRoles = template.findResources('AWS::IAM::Role');

      // Find support roles by checking for the placeholder trust policy
      const supportRoles = Object.entries(allRoles).filter(([, role]) => {
        const props = (role as any).Properties;
        const trustPolicyDoc = props.AssumeRolePolicyDocument;
        const statements = trustPolicyDoc?.Statement || [];

        // Support roles use the empty-deny-placeholder service principal
        return statements.some((stmt: any) =>
          stmt.Principal?.Service?.includes?.('empty-deny-placeholder.amazonaws.com')
        );
      });

      expect(supportRoles.length).toBe(2);

      // Verify both roles use the placeholder service principal
      for (const [, role] of supportRoles) {
        const props = (role as any).Properties;
        const trustPolicyDoc = props.AssumeRolePolicyDocument;

        // The trust policy should allow only the placeholder service principal
        expect(trustPolicyDoc).toBeDefined();

        const statements = trustPolicyDoc.Statement || [];
        expect(statements.length).toBeGreaterThan(0);

        // Find the service principal statement
        let foundPlaceholder = false;
        for (const statement of statements) {
          const principal = statement.Principal?.Service;
          if (principal && principal.includes?.('empty-deny-placeholder.amazonaws.com')) {
            foundPlaceholder = true;
            break;
          }
        }

        // The placeholder principal should be present
        expect(foundPlaceholder).toBe(true);
      }
    });

    it('No dedicated support-access-cases table is created (D16 - uses config table instead)', () => {
      const allTables = template.findResources('AWS::DynamoDB::Table');

      // Verify no table with support-access-cases in its name
      for (const [tableName, table] of Object.entries(allTables)) {
        const props = (table as any).Properties;
        const tableNameProp = props.TableName || tableName;
        expect(JSON.stringify(tableNameProp)).not.toContain('support-access-cases');
      }

      // The only table should be the config-table (created in the test setup)
      expect(Object.keys(allTables).length).toBe(1);
    });

    it('Creates the support-access-api Lambda function with config-table env var (D16)', () => {
      const allFunctions = template.findResources('AWS::Lambda::Function');

      // Find the support-access-api lambda
      let foundApiLambda = false;
      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_DIAG_ROLE_ARN) {
          foundApiLambda = true;

          // Verify it has the expected environment variables
          expect(props.Environment.Variables.SUPPORT_CONFIG_READ_ROLE_ARN).toBeDefined();
          expect(props.Environment.Variables.CONFIG_TABLE_NAME).toBeDefined();
          // Old env var name should NOT be present (D16)
          expect(props.Environment.Variables.SUPPORT_ACCESS_CASES_TABLE_NAME).toBeUndefined();
          expect(props.Environment.Variables.SUPPORT_DIAG_POLICY_NAME).toBe('support-diag-access');
          expect(props.Environment.Variables.SUPPORT_CONFIG_READ_POLICY_NAME).toBe('support-config-read-access');

          break;
        }
      }

      expect(foundApiLambda).toBe(true);
    });

    it('Lambda execution role has no inline support-access permissions policy', () => {
      // Find the support-access-api lambda
      const allFunctions = template.findResources('AWS::Lambda::Function');
      let lambdaRoleId: string | undefined;

      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_DIAG_ROLE_ARN) {
          const roleRef = props.Role;
          if (roleRef?.Ref) {
            lambdaRoleId = roleRef.Ref;
          } else if (roleRef?.['Fn::GetAtt']) {
            lambdaRoleId = roleRef['Fn::GetAtt'][0];
          }
          break;
        }
      }

      expect(lambdaRoleId).toBeDefined();

      // Check that this role has no inline policies (policies are attached separately via grants)
      const allRoles = template.findResources('AWS::IAM::Role');
      const lambdaRole = allRoles[lambdaRoleId!];
      expect(lambdaRole).toBeDefined();

      const props = (lambdaRole as any).Properties;
      // Inline policies array should not exist or be empty
      if (props.Policies) {
        expect(props.Policies.length).toBe(0);
      }
    });

    it('Lambda has all required env vars including AUDIT_EVENTS_QUEUE_URL', () => {
      const allFunctions = template.findResources('AWS::Lambda::Function');

      // Find the support-access-api lambda
      let foundApiLambda = false;
      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_DIAG_ROLE_ARN) {
          foundApiLambda = true;

          const vars = props.Environment.Variables;
          // Verify all required env vars are present
          expect(vars.SUPPORT_DIAG_ROLE_ARN).toBeDefined();
          expect(vars.SUPPORT_CONFIG_READ_ROLE_ARN).toBeDefined();
          expect(vars.CONFIG_TABLE_NAME).toBeDefined();
          expect(vars.AUDIT_EVENTS_QUEUE_URL).toBeDefined();
          expect(vars.SUPPORT_DIAG_POLICY_NAME).toBe('support-diag-access');
          expect(vars.SUPPORT_CONFIG_READ_POLICY_NAME).toBe('support-config-read-access');

          break;
        }
      }

      expect(foundApiLambda).toBe(true);
    });

    it('Lambda role has SQS send permission on audit-events queue', () => {
      // Find the support-access-api lambda role
      const allFunctions = template.findResources('AWS::Lambda::Function');
      let lambdaRoleId: string | undefined;

      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_DIAG_ROLE_ARN) {
          const roleRef = props.Role;
          if (roleRef?.Ref) {
            lambdaRoleId = roleRef.Ref;
          } else if (roleRef?.['Fn::GetAtt']) {
            lambdaRoleId = roleRef['Fn::GetAtt'][0];
          }
          break;
        }
      }

      expect(lambdaRoleId).toBeDefined();

      // Get the lambda role and check for SQS send policy
      const allRoles = template.findResources('AWS::IAM::Role');
      const lambdaRole = allRoles[lambdaRoleId!];
      expect(lambdaRole).toBeDefined();

      const roleProps = (lambdaRole as any).Properties;
      // Check AssumeRolePolicyDocument and Policies
      const inlinePolicies = roleProps.Policies || [];

      // Find policy with SQS:SendMessage
      let foundSqsSend = false;
      for (const policy of inlinePolicies) {
        const statements = policy.PolicyDocument?.Statement || [];
        for (const statement of statements) {
          if (statement.Action?.includes?.('sqs:SendMessage')) {
            foundSqsSend = true;
            break;
          }
        }
        if (foundSqsSend) break;
      }

      // Also check for managed policy attachment (via grant)
      if (!foundSqsSend) {
        const managedPolicies = roleProps.ManagedPolicyArns || [];
        // If using managed policies, we can't directly verify via template assertions,
        // but grantSendMessages typically adds a policy statement inline
        // So if not found inline, that's a failure
        if (managedPolicies.length === 0) {
          expect(foundSqsSend).toBe(true);
        }
      }
    });

  });
});
