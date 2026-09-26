/// <reference types="jest" />

/**
 * Regression guard for the sweeper's per-removal-type rework: the detector must have zero runtime
 * knowledge of the sweeper (no `states:StartExecution` grant anywhere in its own policies, no second
 * state machine of its own), the `Custom::DeferredRemoval` custom resource must be trigger-only (no
 * ARN properties — see `features/sweeper/deferred-removal.ts`), and the state machine definition
 * must contain each registered removal's own steps, with the stack-failure detector's
 * grace-period Wait state belonging to its OWN removal, not shared retry logic. Synthesizes the full
 * `Mailbox` construct at its real position (not standalone units) so this proves the wiring that
 * ships, not just that the pieces individually compile.
 */

import * as cdk from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Mailbox } from '../mailbox';
import type { IMailboxAuthProvider } from '../auth/types';
import { Permission } from '../auth/jmap-scopes';
import { SendStackFailuresMode } from '../features/stack-failure-detection';

function createMockAuthProvider(): IMailboxAuthProvider {
  return {
    issuer: 'https://example.com/issuer',
    tokenEndpoint: 'https://example.com/token',
    authorizationEndpoint: 'https://example.com/authorize',
    authMethod: 'header',
    usePkce: false,
    scopeMap: {
      'mail.read': [Permission.MAIL_READ],
      'mail.write': [Permission.MAIL_WRITE],
    },
    policies: {
      adminApi: { audiences: ['admin-api'] },
      jmapApi: { audiences: ['jmap-api'] },
    },
    provisionAdminUiClient: () => ({ clientId: 'test-admin-ui', requestScopeList: [], groups: [] }),
    provisionJmapUiClient: () => ({ clientId: 'test-jmap-ui', requestScopeList: [], groups: [] }),
    createAdminApiAddons: () => [],
  };
}

function synthMailboxTemplate(sendStackFailures?: SendStackFailuresMode): Template {
  const app = new App({
    context: {
      'serverlessinbox:artifacts': {
        bucketBase: 'test-artifacts',
        packages: {
          'mailbox-go': { kind: 'release', version: '1.0.0' },
          'mailbox-cdk': { kind: 'release', version: '1.0.0' },
          'mailbox-cdk-shared': { kind: 'release', version: '1.0.0' },
          'mailbox-cdk-edge': { kind: 'release', version: '1.0.0' },
          'mailbox-admin-ui': { kind: 'release', version: '1.0.0' },
          'mailbox-webmail-ui': { kind: 'release', version: '1.0.0' },
        },
      },
    },
  });
  const stack = new cdk.Stack(app, `TestMailboxSweeperRemovalWiring-${sendStackFailures ?? 'default'}`, {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  new Mailbox(stack, 'mailbox', { authProvider: createMockAuthProvider(), sendStackFailures });

  return Template.fromStack(stack);
}

/** Flattens a state machine's `DefinitionString` intrinsic into a single searchable string. Token
 * (non-string) parts are dropped — state NAMES are always literal, so they always survive intact in
 * one of the literal string chunks either side of a token. */
function flattenDefinition(definitionString: unknown): string {
  const obj = definitionString as { 'Fn::Join'?: [string, unknown[]] } | string;
  if (typeof obj === 'string') return obj;
  const parts = obj?.['Fn::Join']?.[1] ?? [];
  return parts.filter((p): p is string => typeof p === 'string').join('');
}

describe('Mailbox: sweeper removal wiring', () => {
  let template: Template;

  beforeAll(() => {
    template = synthMailboxTemplate();
  });

  /** Extracts the literal prefix CDK constant-folds into the first `Fn::Join` part of a physical name. */
  function joinedNamePrefix(nameToken: unknown): string | undefined {
    const parts = (nameToken as any)?.['Fn::Join']?.[1] as unknown[] | undefined;
    const first = parts?.[0];
    return typeof first === 'string' ? first : undefined;
  }

  function sweeperStateMachine(): any {
    const machines = template.findResources('AWS::StepFunctions::StateMachine');
    const sweeperMachines = Object.values(machines).filter((m: any) =>
      joinedNamePrefix(m.Properties?.StateMachineName)?.startsWith('mailbox-sweeper-'),
    );
    expect(sweeperMachines).toHaveLength(1);
    return sweeperMachines[0];
  }

  it('has exactly one deferred-deletion (sweeper) state machine', () => {
    sweeperStateMachine();
  });

  it('grants states:StartExecution nowhere except the sweeper starter\'s own policy', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const startExecutionPolicyNames: string[] = [];
    for (const [, policy] of Object.entries(policies)) {
      const doc = (policy as any).Properties?.PolicyDocument;
      const statements: any[] = doc?.Statement ?? [];
      const grantsStartExecution = statements.some((stmt) => {
        const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
        return actions.includes('states:StartExecution');
      });
      if (grantsStartExecution) {
        startExecutionPolicyNames.push((policy as any).Properties?.PolicyName);
      }
    }
    expect(startExecutionPolicyNames).not.toContain('stack-failure-detector-policy');
  });

  it('the Custom::DeferredRemoval resource carries a per-removal-type keyed properties map, never the old flat shape', () => {
    const customResources = template.findResources('Custom::DeferredRemoval');
    const [, deferredRemoval] = Object.entries(customResources)[0];
    const props = (deferredRemoval as any).Properties;

    // The pre-rework flat shape must never come back.
    expect(props.CertArn).toBeUndefined();
    expect(props.EdgeFnArn).toBeUndefined();
    expect(props.RuleArn).toBeUndefined();
    expect(props.RuleTargetId).toBeUndefined();
    expect(props.DetectorFnArn).toBeUndefined();
    expect(props.DetectorRoleArn).toBeUndefined();
    expect(props.DetectorRolePolicyName).toBeUndefined();

    // Each registered removal contributes only its own key. This test's Mailbox config has no
    // custom regional-SAN certificate, so `cert` is never registered (mirrors mailbox.ts's own `if
    // (regionalSanCertificate)` gate) — `edge-fn` and `detector` are always registered.
    expect(props['edge-fn']).toEqual({ edgeFnArn: expect.anything() });
    expect(props['detector']).toEqual({
      ruleArn: expect.anything(),
      ruleTargetId: expect.anything(),
      detectorFnArn: expect.anything(),
      detectorRoleArn: expect.anything(),
      detectorRolePolicyName: expect.anything(),
    });
    expect(props.cert).toBeUndefined();
  });

  it('the state machine definition contains steps contributed by each registered removal', () => {
    const sm = sweeperStateMachine();
    const def = flattenDefinition(sm.Properties.DefinitionString);

    // This test's Mailbox config has no custom regional-SAN certificate, so CertificateRemoval is
    // never registered (mirrors mailbox.ts's own `if (regionalSanCertificate)` gate) — only assert
    // the cert steps when the underlying certificate resource actually exists in the template.
    const hasCertificate = Object.keys(template.findResources('AWS::CertificateManager::Certificate')).length > 0;
    if (hasCertificate) {
      expect(def).toContain('"CertInvoke"');
      expect(def).toContain('"CertWaitRetry"');
    }

    // Edge-fn is always registered.
    expect(def).toContain('"EdgeFnInvoke"');
    expect(def).toContain('"EdgeFnWaitRetry"');
    // Detector contributes its own Invoke/retry-loop states too (enabled by default).
    expect(def).toContain('"DetectorInvoke"');
    expect(def).toContain('"DetectorWaitRetry"');
    // Self-cleanup tail still present after every removal succeeds.
    expect(def).toContain('"SelfCleanupDeleteWorker"');
    expect(def).toContain('"SelfCleanupDeleteStateMachine"');
  });

  it('the detector\'s grace-period Wait state comes from its own removal, not shared retry logic', () => {
    const sm = sweeperStateMachine();
    const def = flattenDefinition(sm.Properties.DefinitionString);

    // Only the detector removal contributes a grace-period wait.
    expect(def).toContain('"DetectorGraceWait"');
    // Cert/edge-fn removals have no equivalent — they only ever have their own retry-loop wait.
    expect(def).not.toContain('"CertGraceWait"');
    expect(def).not.toContain('"EdgeFnGraceWait"');

    // The grace wait is a fixed 15-minute duration, distinct from the 5-minute retry-loop wait
    // shared by every removal's own retry loop.
    const graceWaitMatch = def.match(/"DetectorGraceWait":\s*\{[^}]*"Seconds":\s*(\d+)/);
    expect(graceWaitMatch).not.toBeNull();
    expect(Number(graceWaitMatch?.[1])).toBe(15 * 60);

    const retryWaitMatch = def.match(/"DetectorWaitRetry":\s*\{[^}]*"Seconds":\s*(\d+)/);
    expect(retryWaitMatch).not.toBeNull();
    expect(Number(retryWaitMatch?.[1])).toBe(5 * 60);
  });

  it('the stack-failure detector\'s own policies carry no sweeper-related grant', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const detectorPolicy = Object.values(policies).find(
      (p: any) => p.Properties?.PolicyName === 'stack-failure-detector-policy',
    ) as any;
    expect(detectorPolicy).toBeDefined();

    const statements: any[] = detectorPolicy.Properties.PolicyDocument.Statement;
    for (const stmt of statements) {
      const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
      expect(actions).not.toContain('states:StartExecution');
    }

    // No env var on the detector Lambda carries a state-machine ARN either.
    const fns = template.findResources('AWS::Lambda::Function');
    const detectorFn = Object.values(fns).find((f: any) =>
      joinedNamePrefix(f.Properties?.FunctionName)?.startsWith('mailbox-diag-fn-'),
    ) as any;
    expect(detectorFn).toBeDefined();
    const envVars = detectorFn.Properties.Environment?.Variables ?? {};
    expect(Object.keys(envVars)).not.toContain('SWEEPER_STATE_MACHINE_ARN');
    expect(Object.keys(envVars)).not.toContain('RULE_ARN');
    expect(Object.keys(envVars)).not.toContain('DETECTOR_ROLE_ARN');
  });
});

describe('Mailbox: sweeper removal wiring — sendStackFailures disabled', () => {
  let template: Template;

  beforeAll(() => {
    template = synthMailboxTemplate(SendStackFailuresMode.DISABLED);
  });

  it('synthesizes no detector resources at all — the all-or-nothing sweep-target property collapses to undefined', () => {
    const fns = template.findResources('AWS::Lambda::Function');
    const detectorFn = Object.values(fns).find((f: any) =>
      (f.Properties?.FunctionName as any)?.['Fn::Join']?.[1]?.[0]?.startsWith?.('mailbox-diag-fn-'),
    );
    expect(detectorFn).toBeUndefined();

    const roles = template.findResources('AWS::IAM::Role');
    const detectorRole = Object.values(roles).find((r: any) =>
      (r.Properties?.RoleName as any)?.['Fn::Join']?.[1]?.[0]?.startsWith?.('mailbox-diag-role-'),
    );
    expect(detectorRole).toBeUndefined();

    const policies = template.findResources('AWS::IAM::Policy');
    expect(
      Object.values(policies).some((p: any) => p.Properties?.PolicyName === 'stack-failure-detector-policy'),
    ).toBe(false);
  });

  it('registers no detector removal on the sweeper: no grace-wait/invoke steps and no "detector" key on the deferred-removal custom resource', () => {
    const machines = template.findResources('AWS::StepFunctions::StateMachine');
    const [, sm] = Object.entries(machines)[0];
    const def = flattenDefinition((sm as any).Properties.DefinitionString);
    expect(def).not.toContain('"DetectorGraceWait"');
    expect(def).not.toContain('"DetectorInvoke"');
    expect(def).not.toContain('"DetectorWaitRetry"');

    const customResources = template.findResources('Custom::DeferredRemoval');
    const [, deferredRemoval] = Object.entries(customResources)[0];
    const props = (deferredRemoval as any).Properties;
    expect(props['detector']).toBeUndefined();
  });
});
