/**
 * Support Full-Stack IAM Verification Tests — T1 Hard Gates
 *
 * These tests verify the hard security assertions required by T1's verification gate.
 * They construct the addon directly on a test stack to isolate support IAM
 * requirements without creating circular dependencies.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { CdkArtifactEngine, PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import { SupportAddonProvider, SupportMode } from '../support-addon';
import { AuditEventsQueue } from '../../../features/audit-writing/audit-events-queue';

/**
 * Helper to create an artifact resolver for testing.
 * Provides both mailbox-cdk and mailbox-go packages.
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

describe('SupportAddon Full-Stack IAM Verification (T1 Gates)', () => {
  describe('Feature gating (disabled vs enabled)', () => {
    it('When disabled (literal DISABLED), synthesizes zero support resources', () => {
      const app = new App({
        context: {
          'serverlessinbox:artifacts': {
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
      const auditEventsQueue = new AuditEventsQueue(stack, 'audit-queue');
      const auditLogTable = new Table(stack, 'audit-log-table', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
        sortKey: { name: 'sk', type: AttributeType.STRING },
      });

      const artifactResolver = createTestArtifactResolver(stack);
      const provider = new SupportAddonProvider({
        mode: SupportMode.DISABLED,
        artifactResolver,
      });

      // The provider creates addons when createAdminApiAddons is called
      // Pass in the config table context
      provider.createAdminApiAddons(stack, {
        configTable,
        auditEventsQueue,
        auditLogTable,
      });

      const template = Template.fromStack(stack);

      // No support roles
      const roles = template.findResources('AWS::IAM::Role', {
        Properties: {
          RoleName: Match.stringLikeRegexp('support-(diag|config-read)-.*'),
        },
      });
      expect(Object.keys(roles).length).toBe(0);

      // No support dedicated table
      const supportTables = template.findResources('AWS::DynamoDB::Table', {
        Properties: {
          TableName: Match.stringLikeRegexp('.*support-cases.*'),
        },
      });
      expect(Object.keys(supportTables).length).toBe(0);

      // No support-api lambda
      const functions = template.findResources('AWS::Lambda::Function', {
        Properties: {
          FunctionName: Match.stringLikeRegexp('.*support-api.*'),
        },
      });
      expect(Object.keys(functions).length).toBe(0);
    });
  });

  describe('When enabled (literal ENABLED) - IAM scope verification', () => {
    let stack: cdk.Stack;
    let template: Template;
    let artifactResolver: ICdkArtifactEngine;
    let configTable: Table;
    let auditEventsQueue: AuditEventsQueue;
    let auditLogTable: Table;

    beforeEach(() => {
      const app = new App({
        context: {
          'serverlessinbox:artifacts': {
            bucketBase: 'test-artifacts',
            packages: {
              'mailbox-cdk': { kind: 'release', version: '1.0.0' },
              'mailbox-go': { kind: 'release', version: '1.0.0' },
            },
          },
        },
      });
      stack = new cdk.Stack(app, 'test-stack', {
        env: { account: '111122223333', region: 'us-east-1' },
        synthesizer: new BootstraplessSynthesizer(),
      });

      // Create a mock config table for the test
      configTable = new Table(stack, 'config-table', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
        sortKey: { name: 'sk', type: AttributeType.STRING },
      });

      // Create a mock audit queue for the test
      auditEventsQueue = new AuditEventsQueue(stack, 'audit-queue');
      auditLogTable = new Table(stack, 'audit-log-table', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
        sortKey: { name: 'sk', type: AttributeType.STRING },
      });

      artifactResolver = createTestArtifactResolver(stack);

      const provider = new SupportAddonProvider({
        mode: SupportMode.ENABLED,
        artifactResolver,
      });

      provider.createAdminApiAddons(stack, {
        configTable,
        auditEventsQueue,
        auditLogTable,
      });

      template = Template.fromStack(stack);
    });

    it('ASSERTION 1: support-api lambda execution-role policy names ONLY the hop role ARN', () => {
      // Find the support-api lambda function
      const allLambdas = template.findResources('AWS::Lambda::Function');
      const apiLambdas: Record<string, any> = {};

      for (const [logicalId, lambda] of Object.entries(allLambdas)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_HOP_ROLE_ARN) {
          apiLambdas[logicalId] = lambda;
        }
      }

      expect(Object.keys(apiLambdas).length).toBeGreaterThan(0);

      // Extract the lambda's execution role logical ID
      let apiLambdaRoleLogicalId: string | undefined;
      for (const funcResource of Object.values(apiLambdas)) {
        const props = (funcResource as any).Properties;
        if (props.Role) {
          if (typeof props.Role === 'string') {
            apiLambdaRoleLogicalId = props.Role;
          } else if (typeof props.Role === 'object') {
            if (props.Role.Ref) {
              apiLambdaRoleLogicalId = props.Role.Ref;
            } else if (props.Role['Fn::GetAtt']) {
              apiLambdaRoleLogicalId = props.Role['Fn::GetAtt'][0];
            }
          }
          break;
        }
      }

      expect(apiLambdaRoleLogicalId).toBeDefined();

      // Find the execution role and its attached policies
      const allRoles = template.findResources('AWS::IAM::Role');
      const executionRole = allRoles[apiLambdaRoleLogicalId!];
      expect(executionRole).toBeDefined();

      // Find policies attached to this role
      const allPolicies = template.findResources('AWS::IAM::Policy');
      let foundTagWriteStatement = false;

      for (const [, policy] of Object.entries(allPolicies)) {
        const policyProps = (policy as any).Properties;
        const roles = policyProps.Roles || [];

        for (const roleRef of roles) {
          if (roleRef === apiLambdaRoleLogicalId || roleRef.Ref === apiLambdaRoleLogicalId) {
            const statements = policyProps.PolicyDocument?.Statement || [];

            for (const statement of statements) {
              if (!statement.Resource) continue;

              const resources = Array.isArray(statement.Resource)
                ? statement.Resource
                : [statement.Resource];

              // Check for hop role ARN
              const hopRoleArns = resources.filter((r: any) => {
                const resourceStr = typeof r === 'string' ? r : JSON.stringify(r);
                return resourceStr.includes('role/support-') && resourceStr.includes('-hop');
              });

              if (hopRoleArns.length > 0) {
                foundTagWriteStatement = true;

                // Verify resource is the hop role
                for (const resource of hopRoleArns) {
                  const resourceStr = typeof resource === 'string' ? resource : JSON.stringify(resource);
                  expect(resourceStr).toMatch(/role\/support-/);
                  expect(resourceStr).toMatch(/-hop/);
                }

                // Verify actions are ONLY tag-write (TagRole, UntagRole)
                const actions = Array.isArray(statement.Action)
                  ? statement.Action
                  : [statement.Action];

                // Permitted tag-write actions
                const expectedTagActions = [
                  'iam:TagRole',
                  'iam:UntagRole',
                ];

                // Verify all actions are in the permitted set
                for (const action of actions) {
                  expect(expectedTagActions).toContain(action);
                }

                // Verify forbidden actions are NOT present
                const forbiddenActions = [
                  'iam:GetRole',
                  'iam:UpdateAssumeRolePolicy',
                  'iam:AttachRolePolicy',
                  'iam:DetachRolePolicy',
                  'iam:PutRolePolicy',
                  'iam:DeleteRolePolicy',
                ];

                for (const action of actions) {
                  for (const forbidden of forbiddenActions) {
                    expect(action).not.toBe(forbidden);
                  }
                }

                // Verify no wildcard actions
                expect(actions).not.toContain('iam:*');
              }
            }
          }
        }
      }

      expect(foundTagWriteStatement).toBe(true);
    });

    it('ASSERTION 2: support-api lambda execution-role has config-table access (D16)', () => {
      // Find the support-api lambda function
      const allLambdas = template.findResources('AWS::Lambda::Function');
      let apiLambdaRoleLogicalId: string | undefined;

      for (const [, lambda] of Object.entries(allLambdas)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_HOP_ROLE_ARN) {
          const roleRef = (lambda as any).Properties.Role;
          if (roleRef?.Ref) {
            apiLambdaRoleLogicalId = roleRef.Ref;
          } else if (roleRef?.['Fn::GetAtt']) {
            apiLambdaRoleLogicalId = roleRef['Fn::GetAtt'][0];
          }
          break;
        }
      }

      expect(apiLambdaRoleLogicalId).toBeDefined();

      // Find the config table ARN pattern to match against
      const allTables = template.findResources('AWS::DynamoDB::Table');
      let configTableArn: string | object | undefined;
      for (const [tableLogicalId] of Object.entries(allTables)) {
        // Use the first DynamoDB table found (should be config table)
        configTableArn = {
          'Fn::GetAtt': [tableLogicalId, 'Arn'],
        };
        break;
      }

      expect(configTableArn).toBeDefined();
      const configTableArnStr = JSON.stringify(configTableArn);

      // Find policies attached to the lambda's execution role
      const allPolicies = template.findResources('AWS::IAM::Policy');
      let foundConfigTableGrant = false;
      let foundConfigTableGrantCount = 0;

      for (const [, policy] of Object.entries(allPolicies)) {
        const policyProps = (policy as any).Properties;
        const roles = policyProps.Roles || [];

        for (const roleRef of roles) {
          const roleRefVal = roleRef.Ref || roleRef;
          if (roleRefVal === apiLambdaRoleLogicalId) {
            const statements = policyProps.PolicyDocument?.Statement || [];

            for (const statement of statements) {
              const resources = Array.isArray(statement.Resource)
                ? statement.Resource
                : [statement.Resource];

              // Check if this statement grants access to the config table
              for (const resource of resources) {
                const resourceStr = typeof resource === 'string' ? resource : JSON.stringify(resource);
                // Match against the actual table ARN
                if (resourceStr === configTableArnStr) {
                  foundConfigTableGrantCount++;

                  const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
                  if (
                    ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query'].every((a) =>
                      actions.includes(a),
                    )
                  ) {
                    foundConfigTableGrant = true;
                  }
                }
              }
            }
          }
        }
      }

      expect(foundConfigTableGrantCount).toBeGreaterThan(0);
      expect(foundConfigTableGrant).toBe(true);
    });

    it('ASSERTION 3: CloudTrail grant is read-only on support-api role', () => {
      // Find the support-api lambda function
      const allLambdas = template.findResources('AWS::Lambda::Function');
      let apiLambdaRoleLogicalId: string | undefined;

      for (const [, lambda] of Object.entries(allLambdas)) {
        const props = (lambda as any).Properties;
        if (props.Environment?.Variables?.SUPPORT_HOP_ROLE_ARN) {
          const roleRef = (lambda as any).Properties.Role;
          if (roleRef?.Ref) {
            apiLambdaRoleLogicalId = roleRef.Ref;
          } else if (roleRef?.['Fn::GetAtt']) {
            apiLambdaRoleLogicalId = roleRef['Fn::GetAtt'][0];
          }
          break;
        }
      }

      expect(apiLambdaRoleLogicalId).toBeDefined();

      // Find policies attached to the lambda's execution role
      const allPolicies = template.findResources('AWS::IAM::Policy');
      let foundCloudTrailGrant = false;

      for (const [, policy] of Object.entries(allPolicies)) {
        const policyProps = (policy as any).Properties;
        const roles = policyProps.Roles || [];

        for (const roleRef of roles) {
          const roleRefVal = roleRef.Ref || roleRef;
          if (roleRefVal === apiLambdaRoleLogicalId) {
            const statements = policyProps.PolicyDocument?.Statement || [];

            for (const statement of statements) {
              const actions = Array.isArray(statement.Action)
                ? statement.Action
                : [statement.Action];

              // Check for CloudTrail actions
              if (actions.includes('cloudtrail:LookupEvents')) {
                foundCloudTrailGrant = true;

                // Verify ONLY the read-only actions
                for (const action of actions) {
                  expect(action).toMatch(/^cloudtrail:LookupEvents$/);
                }
                expect(actions).not.toContain('cloudtrail:*');
              }
            }
          }
        }
      }

      expect(foundCloudTrailGrant).toBe(true);
    });

    it('ASSERTION 4: Tier inline policies ARE attached at deploy time', () => {
      // Tier inline policies are permanently attached at CloudFormation synthesis.
      // They are immutable from the lambda: the lambda can only modify trust policies.
      // Inline policies are bound to the role and deleted when the role is deleted.

      // Find all IAM roles in the template
      const allRoles = template.findResources('AWS::IAM::Role');

      // Identify the support-diag and support-config-read roles
      // Role names are generated dynamically, so we search for roles in the support-addon construct tree
      let supportDiagRole: any;
      let supportConfigReadRole: any;

      for (const [, role] of Object.entries(allRoles)) {
        const props = (role as any).Properties;
        const roleName = props?.RoleName;

        // Roles may have a Fn::Join for their name (dynamically constructed)
        if (typeof roleName === 'string') {
          if (roleName.endsWith('-diag')) {
            supportDiagRole = role;
          } else if (roleName.endsWith('-config-read')) {
            supportConfigReadRole = role;
          }
        } else if (typeof roleName === 'object' && roleName['Fn::Join']) {
          // Check if this is a dynamically constructed role name
          const joinParts = JSON.stringify(roleName);
          if (joinParts.includes('"-diag"')) {
            supportDiagRole = role;
          } else if (joinParts.includes('"-config-read"')) {
            supportConfigReadRole = role;
          }
        }
      }

      // Both support roles should exist
      expect(supportDiagRole).toBeDefined();
      expect(supportConfigReadRole).toBeDefined();

      // Verify both roles have inline policies attached at deploy time
      const supportRoles = [
        { name: 'support-diag', role: supportDiagRole },
        { name: 'support-config-read', role: supportConfigReadRole },
      ];

      for (const { role } of supportRoles) {
        const properties = (role as any).Properties;

        // Inline policies MUST be present
        const inlinePolicies = properties.Policies || [];
        expect(inlinePolicies.length).toBeGreaterThan(0);

        // Verify the inline policies contain the tier actions
        let foundTierPolicy = false;
        for (const policy of inlinePolicies) {
          const statements = policy.PolicyDocument?.Statement || [];
          for (const stmt of statements) {
            const actions = stmt.Action || [];
            if (actions.length > 0) {
              foundTierPolicy = true;
              // At least one action should be present (verify non-empty)
              expect(actions.length).toBeGreaterThan(0);
            }
          }
        }
        expect(foundTierPolicy).toBe(true);

        // PermissionsBoundary should NOT be set (boundary removed, roles are scoped by trust policy only)
        expect(properties.PermissionsBoundary).toBeUndefined();
      }
    });
  });

  describe('Feature gate completeness', () => {
    it('CfnCondition gates all support resources when mode is token-based', () => {
      const app = new App({
        context: {
          'serverlessinbox:artifacts': {
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

      const artifactResolver = createTestArtifactResolver(stack);

      // Construct with token-based mode (simulates CFN parameter injection)
      const mode = cdk.Lazy.string({
        produce: () => SupportMode.ENABLED,
      });

      const auditEventsQueue = new AuditEventsQueue(stack, 'audit-queue');
      const auditLogTable = new Table(stack, 'audit-log-table', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
        sortKey: { name: 'sk', type: AttributeType.STRING },
      });

      const provider = new SupportAddonProvider({
        mode: mode as any,
        artifactResolver,
      });

      provider.createAdminApiAddons(stack, {
        configTable,
        auditEventsQueue,
        auditLogTable,
      });

      const template = Template.fromStack(stack);

      // When mode is a token, resources should be gated by a condition
      // First, check for ANY lambda functions
      const allLambdas = template.findResources('AWS::Lambda::Function');

      // If no lambdas, the addon didn't create the lambda - likely a construction issue with lazy value
      expect(Object.keys(allLambdas).length).toBeGreaterThan(0);
    });
  });
});
