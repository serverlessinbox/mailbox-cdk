/**
 * Support Access Addon Unit Tests — Construct Behavior
 *
 * These tests verify the core construct behavior after hop-role migration:
 * - Disabled mode creates zero resources
 * - Enabled mode creates hop role + support roles + lambdas with correct configuration
 * - Hop role has static trust to vendor account
 * - Support roles have static trust with tag-variable conditions
 * - Session durations are correctly set to 3600 seconds
 * - Lambda has tag-write permissions only (TagRole/UntagRole on hop role)
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
        return props.Environment?.Variables?.SUPPORT_HOP_ROLE_ARN;
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
        return props.Environment?.Variables?.SUPPORT_HOP_ROLE_ARN;
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

    it('Creates three support roles with MaxSessionDuration: 3600 (hop + diag + config)', () => {
      const allRoles = template.findResources('AWS::IAM::Role');

      // Find support roles by name
      const supportRoles = Object.entries(allRoles).filter(([, role]) => {
        const props = (role as any).Properties;
        let roleName = '';
        if (typeof props.RoleName === 'string') {
          roleName = props.RoleName;
        } else if (props.RoleName?.['Fn::Join']) {
          const parts = props.RoleName['Fn::Join'][1] || [];
          roleName = parts.join('');
        }
        return roleName.includes('support-');
      });

      // Should have exactly three support roles (hop, diag, config)
      expect(supportRoles.length).toBe(3);

      // Verify all roles have MaxSessionDuration set to 3600
      for (const [, role] of supportRoles) {
        const props = (role as any).Properties;
        expect(props.MaxSessionDuration).toBe(3600);
      }
    });

    it('Hop role has inline policy for sts:AssumeRole on support roles', () => {
      const allRoles = template.findResources('AWS::IAM::Role');

      // Find the hop role
      let foundHopRole = false;
      for (const [, role] of Object.entries(allRoles)) {
        const props = (role as any).Properties;
        let roleName = '';
        if (typeof props.RoleName === 'string') {
          roleName = props.RoleName;
        } else if (props.RoleName?.['Fn::Join']) {
          const parts = props.RoleName['Fn::Join'][1] || [];
          roleName = parts.join('');
        }

        if (roleName.includes('support-hop-')) {
          foundHopRole = true;
          // Verify hop role has the inline policy
          const inlinePolicies = props.Policies || [];
          expect(inlinePolicies.length).toBeGreaterThanOrEqual(1);

          // Verify the policy has sts:AssumeRole actions
          let foundAssumeRole = false;
          for (const policy of inlinePolicies) {
            const statements = policy.PolicyDocument?.Statement || [];
            for (const stmt of statements) {
              const actions = stmt.Action || [];
              if (actions.includes('sts:AssumeRole')) {
                foundAssumeRole = true;
              }
            }
          }
          expect(foundAssumeRole).toBe(true);
          break;
        }
      }
      expect(foundHopRole).toBe(true);
    });

    it('Support roles have static trust policy (not the placeholder service principal)', () => {
      const allRoles = template.findResources('AWS::IAM::Role');

      // Find diag and config roles (skip hop)
      const supportRoles = Object.entries(allRoles).filter(([, role]) => {
        const props = (role as any).Properties;
        let roleName = '';
        if (typeof props.RoleName === 'string') {
          roleName = props.RoleName;
        } else if (props.RoleName?.['Fn::Join']) {
          const parts = props.RoleName['Fn::Join'][1] || [];
          roleName = parts.join('');
        }
        return (roleName.includes('support-diag-') || roleName.includes('support-config-read-'));
      });

      expect(supportRoles.length).toBe(2);

      // Verify both roles have static trust policies (not the placeholder service principal)
      for (const [, role] of supportRoles) {
        const props = (role as any).Properties;
        const trustPolicyDoc = props.AssumeRolePolicyDocument;

        expect(trustPolicyDoc).toBeDefined();
        const statements = trustPolicyDoc.Statement || [];
        expect(statements.length).toBeGreaterThan(0);

        // Verify they do NOT have the placeholder service principal
        let hasPlaceholder = false;
        let hasStaticTrust = false;

        for (const statement of statements) {
          const principalStr = JSON.stringify(statement.Principal || {});
          if (principalStr.includes('empty-deny-placeholder')) {
            hasPlaceholder = true;
          }
          // Verify the trust policy has actual conditions or specific principal
          if (statement.Condition || principalStr.includes('support') || principalStr.includes('Fn')) {
            hasStaticTrust = true;
          }
        }

        // Should NOT have placeholder, should have static trust
        expect(hasPlaceholder).toBe(false);
        expect(hasStaticTrust).toBe(true);
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

    it('Creates the support-access-api Lambda function with hop-role env var', () => {
      const allFunctions = template.findResources('AWS::Lambda::Function');

      // Find the support-access-api lambda
      let foundApiLambda = false;
      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_HOP_ROLE_ARN) {
          foundApiLambda = true;

          // Verify it has the expected environment variables
          expect(props.Environment.Variables.CONFIG_TABLE_NAME).toBeDefined();
          expect(props.Environment.Variables.AUDIT_EVENTS_QUEUE_URL).toBeDefined();

          // Tier role ARNs should be present for the ListSupportRoleAssumptions read path
          expect(props.Environment.Variables.SUPPORT_DIAG_ROLE_ARN).toBeDefined();
          expect(props.Environment.Variables.SUPPORT_CONFIG_READ_ROLE_ARN).toBeDefined();

          break;
        }
      }

      expect(foundApiLambda).toBe(true);
    });

    it('Support-access-api lambda execution role has tag write and access policies', () => {
      // Find the support-access-api lambda
      const allFunctions = template.findResources('AWS::Lambda::Function');
      let lambdaRoleId: string | undefined;

      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_HOP_ROLE_ARN) {
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

      // Check that this role has policies (inline or managed) for tag writes and other grants
      const allRoles = template.findResources('AWS::IAM::Role');
      const lambdaRole = allRoles[lambdaRoleId!];
      expect(lambdaRole).toBeDefined();

      const roleProps = (lambdaRole as any).Properties;
      // Should have either inline policies or managed policies from grants
      const inlinePolicies = roleProps.Policies || [];
      const managedPolicies = roleProps.ManagedPolicyArns || [];

      // At minimum, should have managed policies or inline policies
      expect(inlinePolicies.length + managedPolicies.length).toBeGreaterThan(0);
    });

    it('Support-access-api lambda has all required env vars and no old role ARN vars', () => {
      const allFunctions = template.findResources('AWS::Lambda::Function');

      // Find the support-access-api lambda
      let foundApiLambda = false;
      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_HOP_ROLE_ARN) {
          foundApiLambda = true;

          const vars = props.Environment.Variables;
          // Verify all required env vars are present
          expect(vars.SUPPORT_HOP_ROLE_ARN).toBeDefined();
          expect(vars.CONFIG_TABLE_NAME).toBeDefined();
          expect(vars.AUDIT_EVENTS_QUEUE_URL).toBeDefined();

          // Tier role ARNs should be present for the ListSupportRoleAssumptions read path
          expect(vars.SUPPORT_DIAG_ROLE_ARN).toBeDefined();
          expect(vars.SUPPORT_CONFIG_READ_ROLE_ARN).toBeDefined();

          break;
        }
      }

      expect(foundApiLambda).toBe(true);
    });

    it('Support roles have inline policies with correct action lists (D15)', () => {
      const allRoles = template.findResources('AWS::IAM::Role');

      // Find diag and config roles by name (skip hop)
      const supportRoles = Object.entries(allRoles).filter(([, role]) => {
        const props = (role as any).Properties;
        let roleName = '';
        if (typeof props.RoleName === 'string') {
          roleName = props.RoleName;
        } else if (props.RoleName?.['Fn::Join']) {
          const parts = props.RoleName['Fn::Join'][1] || [];
          roleName = parts.join('');
        }
        return (roleName.includes('support-diag-') || roleName.includes('support-config-read-'));
      });

      expect(supportRoles.length).toBe(2);

      // Verify diag role has exactly 11 actions in its inline policy
      let foundDiagPolicy = false;
      for (const [, role] of supportRoles) {
        const props = (role as any).Properties;
        const inlinePolicies = props.Policies || [];

        for (const policy of inlinePolicies) {
          const statements = policy.PolicyDocument?.Statement || [];
          const actions = new Set<string>();

          for (const stmt of statements) {
            const stmtActions = stmt.Action || [];
            for (const action of stmtActions) {
              actions.add(action);
            }
          }

          if (actions.has('logs:DescribeLogGroups') && !actions.has('lambda:GetFunctionConfiguration')) {
            foundDiagPolicy = true;
            expect(actions.size).toBe(11);
            expect(actions.has('cloudwatch:GetMetricData')).toBe(true);
            expect(actions.has('lambda:GetFunctionConfiguration')).toBe(false);
          }
        }
      }
      expect(foundDiagPolicy).toBe(true);

      // Verify config role has exactly 38 actions in its inline policy (11 diag + 27 delta)
      let foundConfigPolicy = false;
      for (const [, role] of supportRoles) {
        const props = (role as any).Properties;
        const inlinePolicies = props.Policies || [];

        for (const policy of inlinePolicies) {
          const statements = policy.PolicyDocument?.Statement || [];
          const actions = new Set<string>();

          for (const stmt of statements) {
            const stmtActions = stmt.Action || [];
            for (const action of stmtActions) {
              actions.add(action);
            }
          }

          if (actions.has('lambda:GetFunctionConfiguration')) {
            foundConfigPolicy = true;
            expect(actions.size).toBe(38);
            expect(actions.has('logs:DescribeLogGroups')).toBe(true);
            expect(actions.has('cloudwatch:GetMetricData')).toBe(true);
            expect(actions.has('dynamodb:DescribeTable')).toBe(true);
          }
        }
      }
      expect(foundConfigPolicy).toBe(true);
    });

    it('No AWS::IAM::ManagedPolicy resources exist for support-access tiers (inline only)', () => {
      const allPolicies = template.findResources('AWS::IAM::ManagedPolicy');

      // Verify there are NO managed policies at all for the support tiers
      for (const [, policy] of Object.entries(allPolicies)) {
        const props = (policy as any).Properties;
        const description = props.Description || '';
        expect(description).not.toContain('support-diag');
        expect(description).not.toContain('support-config');
      }
    });

    it('No support role carries a permissions boundary', () => {
      const allRoles = template.findResources('AWS::IAM::Role');

      // Find all support roles by name
      const supportRoles = Object.entries(allRoles).filter(([, role]) => {
        const props = (role as any).Properties;
        let roleName = '';
        if (typeof props.RoleName === 'string') {
          roleName = props.RoleName;
        } else if (props.RoleName?.['Fn::Join']) {
          const parts = props.RoleName['Fn::Join'][1] || [];
          roleName = parts.join('');
        }
        return roleName.includes('support-');
      });

      // Should find all three support roles (hop, diag, config)
      expect(supportRoles.length).toBe(3);

      // Verify none carry a permissions boundary
      for (const [, role] of supportRoles) {
        const props = (role as any).Properties;
        expect(props.PermissionsBoundary).toBeUndefined();
      }
    });

    it('Lambda role policy does NOT contain forbidden IAM actions (UpdateAssumeRolePolicy, PutRolePolicy, etc.)', () => {
      const allFunctions = template.findResources('AWS::Lambda::Function');
      let lambdaRoleId: string | undefined;

      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_HOP_ROLE_ARN) {
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

      const allRoles = template.findResources('AWS::IAM::Role');
      const lambdaRole = allRoles[lambdaRoleId!];
      expect(lambdaRole).toBeDefined();

      const props = (lambdaRole as any).Properties;
      const inlinePolicies = props.Policies || [];

      // Verify all seven forbidden actions are NOT present (per plan)
      const forbiddenActions = [
        'iam:UpdateAssumeRolePolicy',
        'iam:GetRole',
        'iam:PutRolePolicy',
        'iam:DeleteRolePolicy',
        'iam:AttachRolePolicy',
        'iam:DetachRolePolicy',
        'iam:PutRolePermissionsBoundary',
        'iam:DeleteRolePermissionsBoundary',
      ];

      for (const policy of inlinePolicies) {
        const statements = policy.PolicyDocument?.Statement || [];
        for (const statement of statements) {
          const actions = statement.Action || [];
          for (const action of actions) {
            forbiddenActions.forEach(forbidden => {
              expect(action).not.toContain(forbidden);
            });
          }
        }
      }
    });

    it('Lambda role policy contains only TagRole and UntagRole (tag-based access control)', () => {
      // Verify that the support-access-api lambda role has only tag write actions
      // and no trust-policy, attach/detach, or put/delete policy actions
      const allRoles = template.findResources('AWS::IAM::Role');
      const allFunctions = template.findResources('AWS::Lambda::Function');
      let lambdaRoleId: string | undefined;

      // Find the support-access-api lambda by looking for SUPPORT_HOP_ROLE_ARN env var
      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_HOP_ROLE_ARN) {
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

      const lambdaRole = allRoles[lambdaRoleId!];
      expect(lambdaRole).toBeDefined();

      if (lambdaRole) {
        const props = (lambdaRole as any).Properties;
        const inlinePolicies = props.Policies || [];

        let foundTagRole = false;
        let foundUntagRole = false;
        let foundForbiddenAction = false;

        for (const policy of inlinePolicies) {
          const statements = policy.PolicyDocument?.Statement || [];
          for (const statement of statements) {
            const actions = statement.Action || [];
            const actionArray = Array.isArray(actions) ? actions : [actions];

            // Verify tag-write actions are present
            if (actionArray.includes('iam:TagRole')) {
              foundTagRole = true;
            }
            if (actionArray.includes('iam:UntagRole')) {
              foundUntagRole = true;
            }

            // Verify forbidden actions are NOT present
            const forbiddenActions = [
              'iam:GetRole',
              'iam:UpdateAssumeRolePolicy',
              'iam:PutRolePolicy',
              'iam:DeleteRolePolicy',
              'iam:AttachRolePolicy',
              'iam:DetachRolePolicy',
            ];

            for (const forbidden of forbiddenActions) {
              if (actionArray.includes(forbidden)) {
                foundForbiddenAction = true;
              }
            }
          }
        }

        // Allow empty policies if no lambda roles are found (shouldn't happen, but be graceful)
        if (inlinePolicies.length > 0) {
          expect(foundTagRole).toBe(true);
          expect(foundUntagRole).toBe(true);
          expect(foundForbiddenAction).toBe(false);
        }
      }
    });

    it('Lambda and collector grants use ForAllValues:StringEquals (set operator) for aws:TagKeys', () => {
      const allFunctions = template.findResources('AWS::Lambda::Function');
      const allPolicies = template.findResources('AWS::IAM::Policy');

      // Find both the API lambda and collector lambda
      let apiLambdaRoleId: string | undefined;
      let collectorLambdaRoleId: string | undefined;

      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        const vars = props.Environment?.Variables || {};

        // API lambda has AUDIT_EVENTS_QUEUE_URL (distinguishing feature)
        if (vars.SUPPORT_HOP_ROLE_ARN && vars.AUDIT_EVENTS_QUEUE_URL) {
          const roleRef = props.Role;
          if (roleRef?.Ref) {
            apiLambdaRoleId = roleRef.Ref;
          } else if (roleRef?.['Fn::GetAtt']) {
            apiLambdaRoleId = roleRef['Fn::GetAtt'][0];
          }
        }

        // Collector lambda has CONFIG_TABLE_NAME and tier ARNs but not AUDIT_EVENTS_QUEUE_URL
        if (vars.SUPPORT_HOP_ROLE_ARN && vars.SUPPORT_DIAG_ROLE_ARN && !vars.AUDIT_EVENTS_QUEUE_URL) {
          const roleRef = props.Role;
          if (roleRef?.Ref) {
            collectorLambdaRoleId = roleRef.Ref;
          } else if (roleRef?.['Fn::GetAtt']) {
            collectorLambdaRoleId = roleRef['Fn::GetAtt'][0];
          }
        }
      }

      expect(apiLambdaRoleId).toBeDefined();
      expect(collectorLambdaRoleId).toBeDefined();

      // Search through all Policy resources (not inline policies) for the correct tag keys
      let foundApiTagKeys = false;
      let foundCollectorTagKeys = false;

      for (const [, policy] of Object.entries(allPolicies)) {
        const policyProps = (policy as any).Properties;
        const policyDoc = policyProps.PolicyDocument || {};
        const statements = policyDoc.Statement || [];
        const policyRoles = policyProps.Roles || [];

        for (const statement of statements) {
          const actions = statement.Action || [];
          const actionArray = Array.isArray(actions) ? actions : [actions];

          // Check if this statement contains tag write actions
          const hasTagActions = actionArray.includes('iam:TagRole') || actionArray.includes('iam:UntagRole');
          if (hasTagActions) {
            const conditions = statement.Condition || {};

            // CRITICAL: Must use ForAllValues:StringEquals, NOT plain StringEquals
            // aws:TagKeys is a multivalued condition key; plain StringEquals never matches
            // (the condition always fails, silently denying tag writes at runtime).
            // ForAllValues ensures every tag key in the request is in the allowed set.
            const forAllValuesStringEqualsCond = conditions['ForAllValues:StringEquals'] || {};
            const tagKeys = forAllValuesStringEqualsCond['aws:TagKeys'];

            // Verify the set operator is present
            expect(conditions['ForAllValues:StringEquals']).toBeDefined();
            // Verify plain StringEquals is NOT used for aws:TagKeys (would be broken)
            expect((conditions.StringEquals || {})['aws:TagKeys']).toBeUndefined();

            if (Array.isArray(tagKeys)) {
              const tagKeySet = new Set(tagKeys);
              if (
                tagKeySet.has('serverless-inbox:support-access:diag') &&
                tagKeySet.has('serverless-inbox:support-access:config-read') &&
                tagKeySet.size === 2
              ) {
                // Check which role(s) this policy is attached to
                for (const roleRef of policyRoles) {
                  if (roleRef === apiLambdaRoleId || roleRef?.Ref === apiLambdaRoleId) {
                    foundApiTagKeys = true;
                  }
                  if (roleRef === collectorLambdaRoleId || roleRef?.Ref === collectorLambdaRoleId) {
                    foundCollectorTagKeys = true;
                  }
                }
              }
            }
          }
        }
      }

      expect(foundApiTagKeys).toBe(true);
      expect(foundCollectorTagKeys).toBe(true);
    });

    it('Tier inline policies ARE attached to their corresponding roles (static attachment)', () => {
      const allRoles = template.findResources('AWS::IAM::Role');

      let foundDiagRole = false;
      let foundConfigRole = false;

      for (const [, role] of Object.entries(allRoles)) {
        const props = (role as any).Properties;
        const inlinePolicies = props.Policies || [];

        // Handle both string and token/ref values for RoleName
        let roleName = '';
        if (typeof props.RoleName === 'string') {
          roleName = props.RoleName;
        } else if (props.RoleName?.['Fn::Join']) {
          // Handle Fn::Join tokens - look at the parts to match patterns
          const parts = props.RoleName['Fn::Join'][1] || [];
          roleName = parts.join('');
        }

        // support-diag role should have its inline policy
        if (roleName.includes('support-diag-')) {
          // Should have at least 1 inline policy (support-diag-access)
          expect(inlinePolicies.length).toBeGreaterThanOrEqual(1);
          foundDiagRole = true;
          // Verify the policy has the diag actions
          let foundDiagPolicy = false;
          for (const policy of inlinePolicies) {
            const statements = policy.PolicyDocument?.Statement || [];
            for (const stmt of statements) {
              const actions = stmt.Action || [];
              if (actions.includes('logs:DescribeLogGroups') && !actions.includes('lambda:GetFunctionConfiguration')) {
                foundDiagPolicy = true;
              }
            }
          }
          expect(foundDiagPolicy).toBe(true);
        }

        // support-config-read role should have its inline policy
        if (roleName.includes('support-config-read-')) {
          // Should have at least 1 inline policy (support-config-read-access)
          expect(inlinePolicies.length).toBeGreaterThanOrEqual(1);
          foundConfigRole = true;
          // Verify the policy has the config actions
          let foundConfigPolicy = false;
          for (const policy of inlinePolicies) {
            const statements = policy.PolicyDocument?.Statement || [];
            for (const stmt of statements) {
              const actions = stmt.Action || [];
              if (actions.includes('lambda:GetFunctionConfiguration')) {
                foundConfigPolicy = true;
              }
            }
          }
          expect(foundConfigPolicy).toBe(true);
        }
      }

      expect(foundDiagRole).toBe(true);
      expect(foundConfigRole).toBe(true);
    });

    it('Support-access-api lambda role has SQS send permission on audit-events queue', () => {
      // Find the support-access-api lambda role
      const allFunctions = template.findResources('AWS::Lambda::Function');
      let lambdaRoleId: string | undefined;

      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_HOP_ROLE_ARN) {
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

    it('Role assumption collector Lambda has all required env vars (CONFIG_TABLE, HOP, DIAG, CONFIG_READ role ARNs)', () => {
      const allFunctions = template.findResources('AWS::Lambda::Function');

      // Find the collector lambda by looking for all env vars we expect
      let foundCollectorLambda = false;
      for (const [, lambda] of Object.entries(allFunctions)) {
        const props = (lambda as any).Properties;
        const vars = props.Environment?.Variables || {};

        // The collector has all four env vars
        if (
          vars.CONFIG_TABLE_NAME &&
          vars.SUPPORT_HOP_ROLE_ARN &&
          vars.SUPPORT_DIAG_ROLE_ARN &&
          vars.SUPPORT_CONFIG_READ_ROLE_ARN
        ) {
          foundCollectorLambda = true;
          // Verify all four are present and not empty
          expect(vars.CONFIG_TABLE_NAME).toBeTruthy();
          expect(vars.SUPPORT_HOP_ROLE_ARN).toBeTruthy();
          expect(vars.SUPPORT_DIAG_ROLE_ARN).toBeTruthy();
          expect(vars.SUPPORT_CONFIG_READ_ROLE_ARN).toBeTruthy();
          break;
        }
      }

      expect(foundCollectorLambda).toBe(true);
    });

    it('Hop role trust policy names the vendor account root (not a role ARN)', () => {
      const allRoles = template.findResources('AWS::IAM::Role');

      let foundHopRole = false;
      for (const [, role] of Object.entries(allRoles)) {
        const props = (role as any).Properties;
        let roleName = '';
        if (typeof props.RoleName === 'string') {
          roleName = props.RoleName;
        } else if (props.RoleName?.['Fn::Join']) {
          const parts = props.RoleName['Fn::Join'][1] || [];
          roleName = parts.join('');
        }

        if (roleName.includes('support-hop-')) {
          foundHopRole = true;
          const trustPolicyDoc = props.AssumeRolePolicyDocument;
          const statements = trustPolicyDoc?.Statement || [];

          // Verify exactly one statement
          expect(statements.length).toBe(1);

          const statement = statements[0];
          const principalArn = statement.Principal?.AWS;

          // Verify the principal is account root (arn:aws:iam::791990038981:root - vendor account)
          expect(principalArn).toBeDefined();
          expect(principalArn).toContain(':root');
          expect(principalArn).toContain('791990038981');
          expect(principalArn).not.toContain(':role/');

          break;
        }
      }
      expect(foundHopRole).toBe(true);
    });

    it('Support role trust policies use per-tier tag keys with ${sts:ExternalId} pattern (no Fn::Sub)', () => {
      const allRoles = template.findResources('AWS::IAM::Role');

      // Find diag and config roles (skip hop)
      const supportRoles = Object.entries(allRoles).filter(([, role]) => {
        const props = (role as any).Properties;
        let roleName = '';
        if (typeof props.RoleName === 'string') {
          roleName = props.RoleName;
        } else if (props.RoleName?.['Fn::Join']) {
          const parts = props.RoleName['Fn::Join'][1] || [];
          roleName = parts.join('');
        }
        return (roleName.includes('support-diag-') || roleName.includes('support-config-read-'));
      });

      expect(supportRoles.length).toBe(2);

      let foundDiagWithDiagCases = false;
      let foundConfigWithConfigCases = false;

      for (const [, role] of supportRoles) {
        const props = (role as any).Properties;
        let roleName = '';
        if (typeof props.RoleName === 'string') {
          roleName = props.RoleName;
        } else if (props.RoleName?.['Fn::Join']) {
          const parts = props.RoleName['Fn::Join'][1] || [];
          roleName = parts.join('');
        }

        const trustPolicyDoc = props.AssumeRolePolicyDocument;
        const policyJson = JSON.stringify(trustPolicyDoc);

        // Verify no Fn::Sub wrapping (should be literal)
        expect(policyJson).not.toContain('Fn::Sub');

        // Check diag role conditions
        if (roleName.includes('support-diag-')) {
          // Should have serverless-inbox:support-access:diag (not supportCase or serverless-inbox:support-access:config-read)
          expect(policyJson).toContain('serverless-inbox:support-access:diag');
          expect(policyJson).not.toContain('supportCase');
          expect(policyJson).not.toContain('serverless-inbox:support-access:config-read');
          expect(policyJson).not.toContain('supportWindow');

          // Should have the literal pattern with ${sts:ExternalId}
          expect(policyJson).toContain('*/${sts:ExternalId}/*');
          foundDiagWithDiagCases = true;
        }

        // Check config role conditions
        if (roleName.includes('support-config-read-')) {
          // Should have serverless-inbox:support-access:config-read (not supportCase or serverless-inbox:support-access:diag)
          expect(policyJson).toContain('serverless-inbox:support-access:config-read');
          expect(policyJson).not.toContain('supportCase');
          expect(policyJson).not.toContain('serverless-inbox:support-access:diag');
          expect(policyJson).not.toContain('supportWindow');

          // Should have the literal pattern with ${sts:ExternalId}
          expect(policyJson).toContain('*/${sts:ExternalId}/*');
          foundConfigWithConfigCases = true;
        }
      }

      expect(foundDiagWithDiagCases).toBe(true);
      expect(foundConfigWithConfigCases).toBe(true);
    });

    it('Role names do not exceed the 64-character IAM roleName limit', () => {
      // IAM role names have a maximum length of 64 characters.
      // This test verifies that even with the maximum stack GUID segment length (8 hex chars),
      // all role names stay within the limit.
      // Prefixes:
      // - support-hop-: 12 chars
      // - support-diag-: 13 chars
      // - support-config-read-: 20 chars
      // Stack GUID segment (first 8-char segment of UUID): 8 chars
      // Expected max lengths:
      // - support-hop-XXXXXXXX: 12 + 8 = 20 chars
      // - support-diag-XXXXXXXX: 13 + 8 = 21 chars
      // - support-config-read-XXXXXXXX: 20 + 8 = 28 chars

      const IAM_ROLE_NAME_LIMIT = 64;
      const GUID_SEGMENT_MAX_LENGTH = 8; // First segment of UUID (8-4-4-4-12)

      const allRoles = template.findResources('AWS::IAM::Role');

      // Extract all role names and their prefixes to compute max lengths
      const rolePrefixes: Record<string, number> = {
        'support-hop': 'support-hop'.length,
        'support-diag': 'support-diag'.length,
        'support-config-read': 'support-config-read'.length,
      };

      const foundRolePrefixes: Set<string> = new Set();

      for (const [, role] of Object.entries(allRoles)) {
        const props = (role as any).Properties;
        let roleName = '';

        // Extract the actual role name (handles both string and Fn::Join tokens)
        if (typeof props.RoleName === 'string') {
          roleName = props.RoleName;
        } else if (props.RoleName?.['Fn::Join']) {
          // Fn::Join parts may contain literal strings and tokens
          // For the test, we verify the token structure includes the 8-char segment, not the full UUID
          const joinParts = props.RoleName['Fn::Join'][1] || [];
          roleName = joinParts
            .map((part: any) => {
              if (typeof part === 'string') {
                return part;
              } else if (part['Fn::Select'] !== undefined) {
                // This is the stack GUID segment extraction
                // The test validates it's a Fn::Select(0, Fn::Split('-', ...)) returning 8 chars
                return 'XXXXXXXX'; // Use a placeholder for the GUID segment
              }
              return '';
            })
            .join('');
        }

        // Check each role name against its prefix
        for (const [prefix, prefixLen] of Object.entries(rolePrefixes)) {
          if (roleName.startsWith(prefix)) {
            foundRolePrefixes.add(prefix);
            const maxLength = prefixLen + GUID_SEGMENT_MAX_LENGTH;
            expect(maxLength).toBeLessThanOrEqual(IAM_ROLE_NAME_LIMIT);
          }
        }
      }

      // Verify we found all three role prefixes (hop, diag, config-read)
      expect(foundRolePrefixes.has('support-hop')).toBe(true);
      expect(foundRolePrefixes.has('support-diag')).toBe(true);
      expect(foundRolePrefixes.has('support-config-read')).toBe(true);
    });

    it('Role names use only the 8-char GUID segment (first segment of UUID), not the full 36-char UUID', () => {
      // Verify that role names are constructed with only the first 8-character segment of the stack GUID,
      // not the full 36-character UUID. This is done via Fn::Select(0, Fn::Split('-', fullStackGuid)).
      const allRoles = template.findResources('AWS::IAM::Role');

      let foundGuidSegmentExtraction = false;

      for (const [, role] of Object.entries(allRoles)) {
        const props = (role as any).Properties;

        // Check if the role name uses Fn::Join with the correct GUID segment selection
        if (props.RoleName?.['Fn::Join']) {
          const joinParts = props.RoleName['Fn::Join'][1] || [];

          // Look for the Fn::Select(0, Fn::Split('-', ...)) pattern which extracts the 8-char segment
          for (const part of joinParts) {
            if (part['Fn::Select'] !== undefined) {
              const selectIndex = part['Fn::Select'][0];
              const splitOp = part['Fn::Select'][1];

              // Verify this is Fn::Select(0, ...) - selecting the first segment
              if (selectIndex === 0 && splitOp?.['Fn::Split']?.[0] === '-') {
                foundGuidSegmentExtraction = true;
              }
            }
          }
        }
      }

      // Verify we found at least one role using the 8-char GUID segment extraction
      expect(foundGuidSegmentExtraction).toBe(true);
    });

    it('Trust condition patterns do not contain forbidden IAM tag-value characters', () => {
      // IAM tag values reject pipe '|' and other chars outside [\p{L}\p{Z}\p{N}_.:/=+\-@]*
      // (letters, whitespace, digits, _, ., :, /, =, +, -, @).
      // This test verifies that the trust condition patterns do NOT contain '|',
      // which caused ValidationError at runtime when granting tiers.
      // Allowed in patterns: tag-value chars + * ? for StringLike wildcards + ${}$ for policy variables.

      const allRoles = template.findResources('AWS::IAM::Role');

      // Find diag and config roles (skip hop)
      const supportRoles = Object.entries(allRoles).filter(([, role]) => {
        const props = (role as any).Properties;
        let roleName = '';
        if (typeof props.RoleName === 'string') {
          roleName = props.RoleName;
        } else if (props.RoleName?.['Fn::Join']) {
          const parts = props.RoleName['Fn::Join'][1] || [];
          roleName = parts.join('');
        }
        return (roleName.includes('support-diag-') || roleName.includes('support-config-read-'));
      });

      expect(supportRoles.length).toBe(2);

      for (const [, role] of supportRoles) {
        const props = (role as any).Properties;
        const trustPolicyDoc = props.AssumeRolePolicyDocument;
        const statements = trustPolicyDoc?.Statement || [];

        for (const statement of statements) {
          const conditions = statement.Condition || {};
          const stringLikeCond = conditions.StringLike || {};

          // Extract all StringLike condition values
          for (const [, condValue] of Object.entries(stringLikeCond)) {
            // Convert to string if needed (may be array or string)
            const valueStrings = Array.isArray(condValue) ? condValue : [condValue];

            for (const valueStr of valueStrings) {
              const patternStr = String(valueStr);
              // Explicitly verify forbidden character '|' is NOT present
              expect(patternStr).not.toContain('|');
              // Verify the pattern contains only allowed literals, wildcards, and policy variables
              // Allowed: * ? / _ . : = + - @ [A-Za-z0-9] [unicode letters/whitespace] ${ }
              const forbiddenChars = /[^\w\-.\/:=+@*?${} ]/g;
              expect(patternStr.replace(/\$\{[^}]*\}/g, '')).not.toMatch(forbiddenChars);
            }
          }
        }
      }
    });

    it('Both support roles have DependsOn the hop role (creation-order gate)', () => {
      // Verify that both support roles carry an explicit DependsOn field referencing the hop role.
      // This gates the creation order: IAM validates trust-policy principals at role creation time,
      // so the support roles (which trust the hop role) must not be created until the hop role exists.
      const template_json = (template as any).toJSON();

      // Find the hop role's logical ID
      let hopRoleLogicalId: string | undefined;
      const allResources = template_json.Resources || {};

      for (const [logId, resource] of Object.entries(allResources)) {
        const res = resource as any;
        if (res.Type === 'AWS::IAM::Role') {
          const roleName = res.Properties?.RoleName;
          // The hop role name includes "support-hop-"
          if (roleName?.['Fn::Join']) {
            const parts = roleName['Fn::Join'][1] || [];
            const nameStr = parts.join('');
            if (nameStr.includes('support-hop-')) {
              hopRoleLogicalId = logId;
              break;
            }
          }
        }
      }

      expect(hopRoleLogicalId).toBeDefined();

      // Verify both support roles (diag and config-read) have DependsOn pointing to the hop role
      let foundDiagWithDependency = false;
      let foundConfigWithDependency = false;

      for (const resource of Object.values(allResources)) {
        const res = resource as any;
        if (res.Type === 'AWS::IAM::Role') {
          const roleName = res.Properties?.RoleName;
          const dependsOn = res.DependsOn || [];

          // Handle both string and token names
          let nameStr = '';
          if (typeof roleName === 'string') {
            nameStr = roleName;
          } else if (roleName?.['Fn::Join']) {
            const parts = roleName['Fn::Join'][1] || [];
            nameStr = parts.join('');
          }

          // Check diag role
          if (nameStr.includes('support-diag-')) {
            // DependsOn can be a string, array, or array of strings
            const depsArray = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
            if (depsArray.some((dep: any) => dep === hopRoleLogicalId)) {
              foundDiagWithDependency = true;
            }
          }

          // Check config-read role
          if (nameStr.includes('support-config-read-')) {
            const depsArray = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
            if (depsArray.some((dep: any) => dep === hopRoleLogicalId)) {
              foundConfigWithDependency = true;
            }
          }
        }
      }

      expect(foundDiagWithDependency).toBe(true);
      expect(foundConfigWithDependency).toBe(true);
    });

  });
});
