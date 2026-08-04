/**
 * SweeperInfra IAM Policy Tests
 *
 * Tests for SweeperInfra construct IAM policy scoping and conditions.
 * Verifies that deletion actions are properly scoped and gated by ownership conditions.
 *
 * Security requirements:
 * - Execution role: iam:DeleteRolePolicy, iam:DeleteRole, states:DeleteStateMachine
 *   MUST be scoped to specific role/state-machine ARNs, never "*"
 * - Worker role: acm:DeleteCertificate, lambda:DeleteFunction MUST carry
 *   Condition gated on serverless-inbox:root-stack tag (ownership enforcement)
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import { SweeperInfra } from '../features/sweeper/sweeper-infra';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { CdkArtifactEngine, PinnedResolver } from '@serverlessinbox/mailbox-cdk-shared';
import type { ArtifactVersionsEntry } from '@serverlessinbox/artifact-registry';
import {
  CloudFormationPolicyStatement,
  CloudFormationResource,
  getPolicyStatements,
  isResourceOfType,
} from './iam-test-helpers';

describe('SweeperInfra IAM Policies', () => {
  let app: App;
  let stack: cdk.Stack;
  let artifactResolver: PinnedResolver;

  beforeEach(() => {
    app = new App({
      context: {
        artifacts: {
          bucketBase: 'test-artifacts',
          packages: {
            'mailbox-cdk': { kind: 'release', version: '1.0.0' },
          },
        },
      },
    });
    stack = new cdk.Stack(app, 'TestStack', {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });

    // Create a pinned resolver with required packages for sweeper lambdas
    const packages: Record<string, ArtifactVersionsEntry> = {
      'mailbox-cdk': { version: '1.0.0', zone: 'regional' },
    };
    const pinnedResolver = new PinnedResolver(stack, packages, 'test-artifacts', {});
    pinnedResolver.registerPackages(['mailbox-cdk']);

    // Wrap in CdkArtifactEngine for the full interface
    const engine = new CdkArtifactEngine(stack, pinnedResolver);
    artifactResolver = engine;
  });

  /**
   * Helper to check if a resource value (which may be a string or CloudFormation intrinsic)
   * contains references to an expected pattern. Returns true if the resource is appropriately scoped.
   */
  function isResourceScoped(resource: unknown, expectedPattern: string | RegExp): boolean {
    if (typeof resource === 'string') {
      // Plain string - use regex matching
      return typeof expectedPattern === 'string'
        ? resource.includes(expectedPattern)
        : expectedPattern.test(resource);
    }

    if (typeof resource === 'object' && resource !== null) {
      const obj = resource as Record<string, unknown>;
      // Handle Fn::Join - check the parts array for the pattern
      if ('Fn::Join' in obj && Array.isArray(obj['Fn::Join'])) {
        const parts = obj['Fn::Join'][1];
        if (Array.isArray(parts)) {
          const joined = parts
            .map((p) => (typeof p === 'string' ? p : ''))
            .join('');
          return typeof expectedPattern === 'string'
            ? joined.includes(expectedPattern)
            : expectedPattern.test(joined);
        }
      }
      // Handle Fn::Sub
      if ('Fn::Sub' in obj && typeof obj['Fn::Sub'] === 'string') {
        const value = obj['Fn::Sub'] as string;
        return typeof expectedPattern === 'string'
          ? value.includes(expectedPattern)
          : expectedPattern.test(value);
      }
    }

    return false;
  }

  describe('Execution Role Policy', () => {
    it('should scope iam:DeleteRolePolicy to specific role ARN (not wildcard)', () => {
      const parent = new cdk.Stack(app, 'ParentStack', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });
      const opsGroup = new Construct(parent, 'ops');

      const sweeper = new SweeperInfra(opsGroup, 'sweeper', { artifactResolver });

      const template = Template.fromStack(parent);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      // Find the execution policy
      let executionPolicyFound = false;
      let foundDeleteRolePolicyStmts = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
        if (resource.Properties?.PolicyName !== 'sweeper-execution-policy') continue;

        executionPolicyFound = true;
        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);

        // Find ALL statements with iam:DeleteRolePolicy (there are multiple - worker and exec self-cleanup)
        const deleteRolePolicyStmts = statements.filter((stmt) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          return actions.includes('iam:DeleteRolePolicy');
        });

        expect(deleteRolePolicyStmts.length).toBeGreaterThan(0);
        foundDeleteRolePolicyStmts = true;

        // All DeleteRolePolicy statements must have scoped resources
        for (const stmt of deleteRolePolicyStmts) {
          const stmtResources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
          // Must NOT be a bare wildcard
          expect(stmtResources).not.toContain('*');
          // Should be a specific ARN pattern (either worker or exec role)
          expect(stmtResources?.[0]).toBeDefined();
          const isWorkerScoped = isResourceScoped(stmtResources?.[0], 'mailbox-sweeper-worker-');
          const isExecScoped = isResourceScoped(stmtResources?.[0], 'mailbox-sweeper-exec-');
          expect(isWorkerScoped || isExecScoped).toBe(true);
        }
      }

      expect(executionPolicyFound).toBe(true);
      expect(foundDeleteRolePolicyStmts).toBe(true);
    });

    it('should scope iam:DeleteRole to specific role ARN (not wildcard)', () => {
      const parent = new cdk.Stack(app, 'ParentStack2', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });
      const opsGroup = new Construct(parent, 'ops');

      const sweeper = new SweeperInfra(opsGroup, 'sweeper', { artifactResolver });

      const template = Template.fromStack(parent);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      let deleteRoleScoped = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
        if (resource.Properties?.PolicyName !== 'sweeper-execution-policy') continue;

        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);
        const stmt = statements.find((s) => {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          return actions.includes('iam:DeleteRole');
        });

        if (stmt) {
          const stmtResources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
          // Worker role deletion must be scoped
          if (stmtResources.some((r) => isResourceScoped(r, 'mailbox-sweeper-worker-'))) {
            expect(stmtResources).not.toContain('*');
            deleteRoleScoped = true;
          }
        }
      }

      expect(deleteRoleScoped).toBe(true);
    });

    it('should scope states:DeleteStateMachine to specific state machine ARN', () => {
      const parent = new cdk.Stack(app, 'ParentStack3', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });
      const opsGroup = new Construct(parent, 'ops');

      const sweeper = new SweeperInfra(opsGroup, 'sweeper', { artifactResolver });

      const template = Template.fromStack(parent);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      let smDeleteScoped = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
        if (resource.Properties?.PolicyName !== 'sweeper-execution-policy') continue;

        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);
        const stmt = statements.find((s) => {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          return actions.includes('states:DeleteStateMachine');
        });

        if (stmt) {
          const stmtResources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
          // State machine deletion must be scoped to a specific ARN
          expect(stmtResources).not.toContain('*');
          expect(stmtResources?.[0]).toBeDefined();
          expect(isResourceScoped(stmtResources?.[0], 'mailbox-sweeper-')).toBe(true);
          smDeleteScoped = true;
        }
      }

      expect(smDeleteScoped).toBe(true);
    });
  });

  describe('Worker Role Policy', () => {
    it('should gate acm:DeleteCertificate with Condition on root-stack tag', () => {
      const parent = new cdk.Stack(app, 'ParentStack4', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });
      const opsGroup = new Construct(parent, 'ops');

      const sweeper = new SweeperInfra(opsGroup, 'sweeper', { artifactResolver });

      const template = Template.fromStack(parent);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      let acmDeleteConditionFound = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
        if (resource.Properties?.PolicyName !== 'sweeper-worker-policy') continue;

        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);
        const stmt = statements.find((s) => {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          return actions.includes('acm:DeleteCertificate');
        });

        expect(stmt).toBeDefined();

        // CRITICAL: Must have a Condition gating the deletion
        expect(stmt?.Condition).toBeDefined();
        expect(stmt?.Condition).toHaveProperty('StringEquals');

        // The condition must reference the root-stack tag
        const stringEquals = stmt?.Condition?.StringEquals;
        expect(stringEquals).toBeDefined();

        // Look for the root-stack tag condition key
        const tagConditionKey = Object.keys(stringEquals || {}).find((key) =>
          key.includes('serverless-inbox:root-stack') || key.includes('aws:ResourceTag')
        );
        expect(tagConditionKey).toBeDefined();

        acmDeleteConditionFound = true;
      }

      expect(acmDeleteConditionFound).toBe(true);
    });

    it('should gate lambda:DeleteFunction with Condition on root-stack tag', () => {
      const parent = new cdk.Stack(app, 'ParentStack5', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });
      const opsGroup = new Construct(parent, 'ops');

      const sweeper = new SweeperInfra(opsGroup, 'sweeper', { artifactResolver });

      const template = Template.fromStack(parent);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      let lambdaDeleteConditionFound = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
        if (resource.Properties?.PolicyName !== 'sweeper-worker-policy') continue;

        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);
        const stmt = statements.find((s) => {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          return actions.includes('lambda:DeleteFunction');
        });

        expect(stmt).toBeDefined();

        // CRITICAL: Must have a Condition gating the deletion
        expect(stmt?.Condition).toBeDefined();
        expect(stmt?.Condition).toHaveProperty('StringEquals');

        // The condition must reference the root-stack tag
        const stringEquals = stmt?.Condition?.StringEquals;
        expect(stringEquals).toBeDefined();

        // Look for the root-stack tag condition key
        const tagConditionKey = Object.keys(stringEquals || {}).find((key) =>
          key.includes('serverless-inbox:root-stack') || key.includes('aws:ResourceTag')
        );
        expect(tagConditionKey).toBeDefined();

        lambdaDeleteConditionFound = true;
      }

      expect(lambdaDeleteConditionFound).toBe(true);
    });

    it('should allow unconditioned acm:DescribeCertificate (read operation)', () => {
      const parent = new cdk.Stack(app, 'ParentStack6', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });
      const opsGroup = new Construct(parent, 'ops');

      const sweeper = new SweeperInfra(opsGroup, 'sweeper', { artifactResolver });

      const template = Template.fromStack(parent);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      let describeCertFound = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
        if (resource.Properties?.PolicyName !== 'sweeper-worker-policy') continue;

        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);
        const stmt = statements.find((s) => {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          return actions.includes('acm:DescribeCertificate');
        });

        if (stmt) {
          // Read operations can be unconditioned
          expect(stmt).toBeDefined();
          describeCertFound = true;
        }
      }

      expect(describeCertFound).toBe(true);
    });

    it('should allow unconditioned lambda:GetFunction (read operation)', () => {
      const parent = new cdk.Stack(app, 'ParentStack7', {
        env: { account: '123456789012', region: 'us-west-2' },
        synthesizer: new BootstraplessSynthesizer(),
      });
      const opsGroup = new Construct(parent, 'ops');

      const sweeper = new SweeperInfra(opsGroup, 'sweeper', { artifactResolver });

      const template = Template.fromStack(parent);
      const resources = template.toJSON().Resources as Record<string, CloudFormationResource> | undefined;
      if (!resources) throw new Error('No resources in template');

      let getFunctionFound = false;
      for (const [, resource] of Object.entries(resources)) {
        if (!isResourceOfType(resource, 'AWS::IAM::Policy')) continue;
        if (resource.Properties?.PolicyName !== 'sweeper-worker-policy') continue;

        const statements = getPolicyStatements(resource.Properties?.PolicyDocument);
        const stmt = statements.find((s) => {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          return actions.includes('lambda:GetFunction');
        });

        if (stmt) {
          // Read operations can be unconditioned
          expect(stmt).toBeDefined();
          getFunctionFound = true;
        }
      }

      expect(getFunctionFound).toBe(true);
    });
  });
});
