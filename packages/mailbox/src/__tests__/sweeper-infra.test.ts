/**
 * SweeperInfra IAM Policy Tests
 *
 * Tests for SweeperInfra construct IAM policy scoping and conditions. `SweeperInfra` no longer
 * hardcodes any target's grants itself — it concatenates whatever each registered `IResourceRemoval`
 * contributes via `grantStatements()` (see `features/sweeper/*-removal.ts`) into one
 * `sweeper-worker-policy`. These tests build a `SweeperInfra` with one of each removal type and
 * verify the resulting consolidated policy still enforces least privilege.
 *
 * Security requirements:
 * - Execution role: iam:DeleteRolePolicy, iam:DeleteRole, states:DeleteStateMachine
 *   MUST be scoped to specific role/state-machine ARNs, never "*"
 * - Worker role: acm:DeleteCertificate, lambda:DeleteFunction MUST carry
 *   Condition gated on serverless-inbox:root-stack tag (ownership enforcement)
 * - Worker role: iam:DeleteRole/DeleteRolePolicy for the detector's role MUST be scoped to that
 *   role's own ARN (a real token), never a tag condition (unsupported) or a bare wildcard.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as awslambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import { SweeperInfra } from '../features/sweeper/sweeper-infra';
import { CertificateRemoval } from '../features/sweeper/certificate-removal';
import { EdgeFunctionRemoval } from '../features/sweeper/edge-function-removal';
import { StackFailureDetectorRemoval } from '../features/sweeper/stack-failure-detector-removal';
import type { IResourceRemoval } from '../features/sweeper/removal';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { actionsOf, renderLiteralText, resourcesOf, statementsOfNamedPolicy } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import type { PolicyStatementJson } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';

describe('SweeperInfra IAM Policies', () => {
  let app: App;
  let artifactResolver: IArtifactResolver;

  beforeEach(() => {
    app = new App();
  });

  function buildStack(id: string): cdk.Stack {
    const stack = new cdk.Stack(app, id, {
      env: { account: '123456789012', region: 'us-west-2' },
      synthesizer: new BootstraplessSynthesizer(),
    });
    const packages: Record<string, ArtifactPin> = {
      'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    };
    artifactResolver = new PinnedArtifactResolver({
      packages,
      location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    });
    return stack;
  }

  /** One of each removal type, built with real (imported/fresh) CDK objects. */
  function buildRemovals(scope: Construct): IResourceRemoval[] {
    const certificate = acm.Certificate.fromCertificateArn(
      scope,
      'cert-ref',
      'arn:aws:acm:us-west-2:123456789012:certificate/test-cert',
    );
    const edgeFunction = awslambda.Function.fromFunctionArn(
      scope,
      'edge-fn-ref',
      'arn:aws:lambda:us-east-1:123456789012:function:edge-fn',
    );
    const rule = new events.Rule(scope, 'detector-rule', { eventPattern: { source: ['aws.cloudformation'] } });
    const detectorRole = new iam.Role(scope, 'detector-role', {
      roleName: 'mailbox-diag-role-test',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    const detectorFn = awslambda.Function.fromFunctionArn(
      scope,
      'detector-fn-ref',
      'arn:aws:lambda:us-west-2:123456789012:function:mailbox-diag-fn-test',
    );

    return [
      new CertificateRemoval(scope, 'cert-removal', { certificate }),
      new EdgeFunctionRemoval(scope, 'edge-fn-removal', { function: edgeFunction }),
      new StackFailureDetectorRemoval(scope, 'stack-failure-detector-removal', {
        rule,
        ruleTargetId: 'Target0',
        detector: detectorFn,
        role: detectorRole,
        detectorRolePolicyName: 'stack-failure-detector-policy',
      }),
    ];
  }

  function findWorkerPolicyStatements(parent: cdk.Stack): PolicyStatementJson[] {
    return statementsOfNamedPolicy(Template.fromStack(parent), 'sweeper-worker-policy');
  }

  function findExecutionPolicyStatements(parent: cdk.Stack): PolicyStatementJson[] {
    return statementsOfNamedPolicy(Template.fromStack(parent), 'sweeper-execution-policy');
  }

  /**
   * Helper to check if a resource value (which may be a string or CloudFormation intrinsic)
   * contains references to an expected pattern.
   */
  function isResourceScoped(resource: unknown, expectedPattern: string | RegExp): boolean {
    if (typeof resource === 'string') {
      return typeof expectedPattern === 'string'
        ? resource.includes(expectedPattern)
        : expectedPattern.test(resource);
    }
    if (typeof resource === 'object' && resource !== null) {
      const obj = resource as Record<string, unknown>;
      if ('Fn::Join' in obj) {
        const joined = renderLiteralText(resource);
        return typeof expectedPattern === 'string'
          ? joined.includes(expectedPattern)
          : expectedPattern.test(joined);
      }
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
    it('scopes iam:DeleteRolePolicy to specific role ARN (not wildcard)', () => {
      const stack = buildStack('ParentStack');
      const opsGroup = new Construct(stack, 'ops');
      new SweeperInfra(opsGroup, 'sweeper', { artifactResolver, removals: buildRemovals(opsGroup) });

      const statements = findExecutionPolicyStatements(stack);
      const deleteRolePolicyStmts = statements.filter((s) => {
        const actions = actionsOf(s);
        return actions.includes('iam:DeleteRolePolicy');
      });
      expect(deleteRolePolicyStmts.length).toBeGreaterThan(0);
      for (const stmt of deleteRolePolicyStmts) {
        const stmtResources = resourcesOf(stmt);
        expect(stmtResources).not.toContain('*');
        const isWorkerScoped = isResourceScoped(stmtResources?.[0], 'mailbox-sweeper-worker-');
        const isExecScoped = isResourceScoped(stmtResources?.[0], 'mailbox-sweeper-exec-');
        expect(isWorkerScoped || isExecScoped).toBe(true);
      }
    });

    it('scopes states:DeleteStateMachine to a specific state machine ARN', () => {
      const stack = buildStack('ParentStack2');
      const opsGroup = new Construct(stack, 'ops');
      new SweeperInfra(opsGroup, 'sweeper', { artifactResolver, removals: buildRemovals(opsGroup) });

      const statements = findExecutionPolicyStatements(stack);
      const stmt = statements.find((s) => {
        const actions = actionsOf(s);
        return actions.includes('states:DeleteStateMachine');
      });
      expect(stmt).toBeDefined();
      const stmtResources = resourcesOf(stmt!);
      expect(stmtResources).not.toContain('*');
      expect(isResourceScoped(stmtResources?.[0], 'mailbox-sweeper-')).toBe(true);
    });
  });

  describe('Worker Role Policy — per-removal grants', () => {
    it('gates acm:DeleteCertificate with a Condition on the root-stack tag', () => {
      const stack = buildStack('ParentStack3');
      const opsGroup = new Construct(stack, 'ops');
      new SweeperInfra(opsGroup, 'sweeper', { artifactResolver, removals: buildRemovals(opsGroup) });

      const statements = findWorkerPolicyStatements(stack);
      const stmt = statements.find((s) => {
        const actions = actionsOf(s);
        return actions.includes('acm:DeleteCertificate');
      });
      expect(stmt).toBeDefined();
      expect(stmt?.Condition).toBeDefined();
      const stringEquals = stmt?.Condition?.StringEquals;
      const tagConditionKey = Object.keys(stringEquals || {}).find((key) => key.includes('aws:ResourceTag'));
      expect(tagConditionKey).toBeDefined();
    });

    it('gates edge lambda:DeleteFunction (us-east-1) with a Condition on the root-stack tag', () => {
      const stack = buildStack('ParentStack4');
      const opsGroup = new Construct(stack, 'ops');
      new SweeperInfra(opsGroup, 'sweeper', { artifactResolver, removals: buildRemovals(opsGroup) });

      const statements = findWorkerPolicyStatements(stack);
      const lambdaDeleteStmts = statements.filter((s) => {
        const actions = actionsOf(s);
        return actions.includes('lambda:DeleteFunction');
      });
      // One for the us-east-1 edge target, one for the stack's own-region detector target.
      expect(lambdaDeleteStmts.length).toBe(2);
      for (const stmt of lambdaDeleteStmts) {
        expect(stmt.Condition).toBeDefined();
      }
      const usEast1Stmt = lambdaDeleteStmts.find((s) => isResourceScoped(s.Resource, 'us-east-1'));
      expect(usEast1Stmt).toBeDefined();
    });

    it('gates events:DeleteRule/RemoveTargets with a Condition on the root-stack tag', () => {
      const stack = buildStack('ParentStack5');
      const opsGroup = new Construct(stack, 'ops');
      new SweeperInfra(opsGroup, 'sweeper', { artifactResolver, removals: buildRemovals(opsGroup) });

      const statements = findWorkerPolicyStatements(stack);
      const stmt = statements.find((s) => {
        const actions = actionsOf(s);
        return actions.includes('events:DeleteRule');
      });
      expect(stmt).toBeDefined();
      expect(stmt?.Condition).toBeDefined();
      const stmtResources = resourcesOf(stmt!);
      expect(stmtResources).not.toContain('*');
    });

    it('scopes iam:DeleteRole/DeleteRolePolicy to the detector role\'s own ARN, not a tag condition or a bare wildcard', () => {
      const stack = buildStack('ParentStack6');
      const opsGroup = new Construct(stack, 'ops');
      new SweeperInfra(opsGroup, 'sweeper', { artifactResolver, removals: buildRemovals(opsGroup) });

      const statements = findWorkerPolicyStatements(stack);
      const stmt = statements.find((s) => {
        const actions = actionsOf(s);
        return actions.includes('iam:DeleteRole') && actions.includes('iam:DeleteRolePolicy');
      });

      expect(stmt).toBeDefined();
      // iam:DeleteRole/DeleteRolePolicy don't support aws:ResourceTag at all — must NOT be
      // tag-conditioned (that would be a no-op gate, not real scoping).
      expect(stmt?.Condition).toBeUndefined();
      const stmtResources = resourcesOf(stmt!);
      expect(stmtResources).not.toContain('*');
      // Scoped to the role's own real ARN (a GetAtt token), not a wildcard name-prefix pattern.
      expect(typeof stmtResources?.[0]).toBe('object');
    });

    it('allows unconditioned read operations (ACM/Lambda/EventBridge/IAM describe-style calls)', () => {
      const stack = buildStack('ParentStack7');
      const opsGroup = new Construct(stack, 'ops');
      new SweeperInfra(opsGroup, 'sweeper', { artifactResolver, removals: buildRemovals(opsGroup) });

      const statements = findWorkerPolicyStatements(stack);
      for (const action of ['acm:DescribeCertificate', 'lambda:GetFunction', 'events:DescribeRule', 'iam:ListRoleTags']) {
        const stmt = statements.find((s) => {
          const actions = actionsOf(s);
          return actions.includes(action);
        });
        expect(stmt).toBeDefined();
      }
    });
  });
});
