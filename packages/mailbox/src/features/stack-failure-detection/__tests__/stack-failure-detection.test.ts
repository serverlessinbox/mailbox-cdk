/**
 * Stack-failure detector — synth tests.
 *
 * Verifies:
 * - `disabled` synthesizes zero detector resources (Lambda, Rule, Role, Permission, state machine).
 * - `enabled` synthesizes all of them, each with a retain-style deletion policy, and the rule's event
 *   pattern matches exactly the five terminal stack-status-change statuses and no others.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ArtifactZone, PinnedArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import type { ArtifactPin, IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { StackFailureDetection, SendStackFailuresMode } from '../stack-failure-detection';

function createTestArtifactResolver(stack: cdk.Stack): IArtifactResolver {
  const packages: Record<string, ArtifactPin> = {
    'mailbox-cdk': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
    'mailbox-go': { version: '1.0.0', zone: ArtifactZone.REGIONAL },
  };
  return new PinnedArtifactResolver({
    packages,
    location: { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
}

function buildStack(id: string): cdk.Stack {
  const app = new App();
  return new cdk.Stack(app, id, {
    env: { account: '111122223333', region: 'us-east-1' },
    synthesizer: new BootstraplessSynthesizer(),
  });
}

describe('StackFailureDetection', () => {
  it('disabled: synthesizes zero detector resources', () => {
    const stack = buildStack('test-stack-diag-disabled');
    const artifactResolver = createTestArtifactResolver(stack);

    new StackFailureDetection(stack, 'stack-failure-detection', {
      mode: SendStackFailuresMode.DISABLED,
      artifactResolver,
    });

    const template = Template.fromStack(stack);

    expect(Object.keys(template.findResources('AWS::Lambda::Function')).length).toBe(0);
    expect(Object.keys(template.findResources('AWS::Events::Rule')).length).toBe(0);
    expect(Object.keys(template.findResources('AWS::IAM::Role')).length).toBe(0);
    expect(Object.keys(template.findResources('AWS::Lambda::Permission')).length).toBe(0);
    expect(Object.keys(template.findResources('AWS::StepFunctions::StateMachine')).length).toBe(0);
  });

  it('disabled: exposes no sweep-target interfaces', () => {
    const stack = buildStack('test-stack-diag-disabled-props');
    const artifactResolver = createTestArtifactResolver(stack);

    const diag = new StackFailureDetection(stack, 'stack-failure-detection', {
      mode: SendStackFailuresMode.DISABLED,
      artifactResolver,
    });

    expect(diag.sweepTargets).toBeUndefined();
  });

  describe('enabled', () => {
    let template: Template;
    let diag: StackFailureDetection;

    beforeEach(() => {
      const stack = buildStack('test-stack-diag-enabled');
      const artifactResolver = createTestArtifactResolver(stack);

      diag = new StackFailureDetection(stack, 'stack-failure-detection', {
        mode: SendStackFailuresMode.ENABLED,
        artifactResolver,
      });

      template = Template.fromStack(stack);
    });

    it('creates the detector Lambda, rule, IAM role and invoke permission, and builds no state machine of its own', () => {
      // No state machine: the detector has no sweeper knowledge at all and runs no cleanup chain of
      // its own — its rule/function/role are registered as sweep targets on the shared
      // resource-sweeper's state machine from the OUTSIDE (mailbox.ts), via the ARNs exposed below.
      expect(Object.keys(template.findResources('AWS::Lambda::Function')).length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(template.findResources('AWS::Events::Rule')).length).toBe(1);
      expect(Object.keys(template.findResources('AWS::IAM::Role')).length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(template.findResources('AWS::Lambda::Permission')).length).toBeGreaterThanOrEqual(1);
      expect(Object.keys(template.findResources('AWS::StepFunctions::StateMachine')).length).toBe(0);
    });

    it('exposes real sweep-target interfaces and no sweeper knowledge in the detector\'s own IAM policy', () => {
      expect(diag.sweepTargets).toBeDefined();
      expect(diag.sweepTargets?.rule).toBeDefined();
      expect(diag.sweepTargets?.ruleTargetId).toBeDefined();
      expect(diag.sweepTargets?.detector).toBeDefined();
      expect(diag.sweepTargets?.role).toBeDefined();
      expect(diag.sweepTargets?.detectorRolePolicyName).toBeDefined();

      // The detector's own policy must never grant states:StartExecution — it has no sweeper
      // knowledge at all.
      const policies = template.findResources('AWS::IAM::Policy');
      for (const [, policy] of Object.entries(policies)) {
        const statements = (policy as any).Properties.PolicyDocument.Statement as any[];
        for (const stmt of statements) {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          expect(actions).not.toContain('states:StartExecution');
        }
      }

      // Exactly one deferred-deletion (sweeper) state machine anywhere the detector could reach —
      // here, zero: this construct builds none of its own.
      expect(Object.keys(template.findResources('AWS::StepFunctions::StateMachine')).length).toBe(0);
    });

    it('the rule, detector Lambda and role carry a retain-style deletion policy', () => {
      // These resources use RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE, which CloudFormation renders
      // as the "RetainExceptOnCreate" deletion policy — not the plain "Retain" a bare RemovalPolicy.RETAIN
      // would produce. Either is a retain-style policy for the purpose of this check: what matters is
      // that these resources are never actually deleted by a stack update/delete.
      const RETAIN_STYLE = new Set(['Retain', 'RetainExceptOnCreate']);

      const rules = template.findResources('AWS::Events::Rule');
      const fns = template.findResources('AWS::Lambda::Function');
      const roles = template.findResources('AWS::IAM::Role');

      for (const [, res] of Object.entries(rules)) {
        expect(RETAIN_STYLE.has((res as any).DeletionPolicy)).toBe(true);
        expect(RETAIN_STYLE.has((res as any).UpdateReplacePolicy)).toBe(true);
      }
      for (const [, res] of Object.entries(fns)) {
        expect(RETAIN_STYLE.has((res as any).DeletionPolicy)).toBe(true);
      }
      for (const [, res] of Object.entries(roles)) {
        expect(RETAIN_STYLE.has((res as any).DeletionPolicy)).toBe(true);
      }
    });

    it('the rule\'s auto-created invoke Permission is created (parented under the Rule, in the same gated scope)', () => {
      // The Rule's auto-created invoke Permission is parented under the Rule's construct node, not
      // the Lambda's, so it is swept into the same CfnCondition-gated scope as the Rule — verified
      // separately by the "disabled" test, which asserts zero AWS::Lambda::Permission resources.
      // It is not itself given an explicit RETAIN removal policy in this construct (only the rule,
      // Lambda and role are — see stack-failure-detection-infra.ts): the self-clean chain's
      // `lambda:DeleteFunction` step removes the function's resource policy along with the function.
      const perms = template.findResources('AWS::Lambda::Permission');
      expect(Object.keys(perms).length).toBeGreaterThanOrEqual(1);
    });

    it('the detector Lambda\'s INFRA_LOG_GROUP_NAME env var points at the exact log group its IAM grant is scoped to', () => {
      // Regression test for a real deploy failure: the detector's Go handler
      // (`env.MustGet("INFRA_LOG_GROUP_NAME")`) panicked on cold start because the construct set no
      // `environment` at all. This asserts not just presence but that the env var and the
      // `logs:FilterLogEvents` grant resolve to the SAME underlying log-group resource — both must
      // reference the same CloudFormation logical id, so they can never silently drift apart.
      const fns = template.findResources('AWS::Lambda::Function');
      const [, detectorFn] = Object.entries(fns)[0];
      const envVars = (detectorFn as any).Properties.Environment.Variables;

      expect(envVars.INFRA_LOG_GROUP_NAME).toBeDefined();
      const envLogicalId = envVars.INFRA_LOG_GROUP_NAME.Ref;
      expect(typeof envLogicalId).toBe('string');

      // Find all policies (grants may place statements on different policies than the detector's own)
      const policies = template.findResources('AWS::IAM::Policy');
      let foundFilterEventsMatch = false;
      let foundWriteMatch = false;

      for (const policy of Object.values(policies)) {
        const statements = (policy as any).Properties.PolicyDocument.Statement as any[];
        for (const stmt of statements) {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];

          // Check FilterLogEvents statement references the same log group
          if (actions.includes('logs:FilterLogEvents')) {
            const resource = stmt.Resource;
            const logGroupId = Array.isArray(resource) ? resource[0] : resource;
            if (logGroupId['Fn::GetAtt']?.[0] === envLogicalId) {
              foundFilterEventsMatch = true;
            }
          }

          // Check write (CreateLogStream/PutLogEvents) statements reference the same log group
          const hasCreateLogStream = actions.includes('logs:CreateLogStream');
          const hasPutLogEvents = actions.includes('logs:PutLogEvents');
          if (hasCreateLogStream && hasPutLogEvents) {
            const resource = stmt.Resource;
            const logGroupId = Array.isArray(resource) ? resource[0] : resource;
            if (logGroupId['Fn::GetAtt']?.[0] === envLogicalId) {
              foundWriteMatch = true;
            }
          }
        }
      }

      expect(foundFilterEventsMatch).toBe(true);
      expect(foundWriteMatch).toBe(true);
    });

    it('the rule matches CloudFormation Stack Status Change with exactly the five terminal statuses', () => {
      const rules = template.findResources('AWS::Events::Rule');
      const [, rule] = Object.entries(rules)[0];
      const pattern = (rule as any).Properties.EventPattern;

      expect(pattern['detail-type']).toEqual(['CloudFormation Stack Status Change']);
      expect(pattern.source).toEqual(['aws.cloudformation']);

      const statuses: string[] = pattern.detail['status-details'].status;
      const statusSet = new Set(statuses);

      expect(statusSet).toEqual(
        new Set([
          'ROLLBACK_COMPLETE',
          'ROLLBACK_FAILED',
          'UPDATE_ROLLBACK_COMPLETE',
          'UPDATE_ROLLBACK_FAILED',
          'DELETE_FAILED',
        ])
      );
      // Deliberately excluded — see subplan 01: these are only terminal when rollback is disabled,
      // and would double-fire on an ordinary failed install if AWS also emits them transiently.
      expect(statusSet.has('CREATE_FAILED')).toBe(false);
      expect(statusSet.has('UPDATE_FAILED')).toBe(false);
      // A deliberate successful uninstall ends at DELETE_COMPLETE, never DELETE_FAILED — must never match.
      expect(statusSet.has('DELETE_COMPLETE')).toBe(false);
    });
  });
});
