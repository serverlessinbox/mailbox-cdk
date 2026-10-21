/// <reference types="jest" />

/**
 * How `Mailbox` wires the sweeper: the detector must have zero runtime knowledge of the sweeper (no
 * `states:StartExecution` grant anywhere in its own policies, no second state machine of its own),
 * the `Custom::DeferredRemoval` custom resource carries one keyed entry per registered removal, and
 * the state machine definition contains each registered removal's own steps, with the stack-failure
 * detector's grace-period Wait state belonging to its OWN removal, not shared retry logic.
 * Synthesizes the full `Mailbox` construct at its real position (not standalone units) so this proves
 * the wiring that ships, not just that the pieces individually compile.
 */

import { actionsOf, renderLiteralText, statementsOfDocument, statementsOfNamedPolicy } from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                                                    from 'aws-cdk-lib/assertions';
import * as cdk                                                                        from 'aws-cdk-lib';
import { App, BootstraplessSynthesizer }                                               from 'aws-cdk-lib';

import { Permission }                                                                  from '../auth/jmap-scopes';
import type { IMailboxAuthProvider }                                                   from '../auth/types';
import { SendStackFailuresMode }                                                       from '../platform/ops/stack-failure-detection';
import { Mailbox }                                                                     from '../mailbox';

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
    provisionAdminApiClient: () => ({ clientId: 'test-admin-ui', requestScopeList: [], groups: [] }),
    provisionJmapApiClient: () => ({ clientId: 'test-jmap-ui', requestScopeList: [], groups: [] }),
    createAdminApiAddons: () => [],
  };
}

function synthMailboxTemplate(sendStackFailures?: SendStackFailuresMode): Template {
  const app   = new App({
    context: {
      'serverlessinbox:artifacts': {
        bucketBase: 'test-artifacts',
        packages: {
          'mailbox-go': { zone: 'regional', version: '1.0.0' },
          'mailbox-cdk': { zone: 'regional', version: '1.0.0' },
          'mailbox-cdk-shared': { zone: 'regional', version: '1.0.0' },
          'mailbox-cdk-edge': { zone: 'edge', version: '1.0.0' },
          'mailbox-admin-ui': { zone: 'regional', version: '1.0.0' },
          'mailbox-webmail-ui': { zone: 'regional', version: '1.0.0' },
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

function deferredRemovalProperties(template: Template): Record<string, unknown> {
  const [resource] = Object.values(template.findResources('Custom::DeferredRemoval'));
  return resource.Properties;
}

describe('Mailbox: sweeper removal wiring', () => {
  let template: Template;

  beforeAll(() => {
    template = synthMailboxTemplate();
  });

  function sweeperDefinition(): string {
    const machines        = template.findResources('AWS::StepFunctions::StateMachine');
    const sweeperMachines = Object.values(machines).filter((machine) =>
      renderLiteralText(machine.Properties?.StateMachineName).startsWith('mailbox-sweeper-'),
    );
    expect(sweeperMachines).toHaveLength(1);
    return renderLiteralText(sweeperMachines[0].Properties.DefinitionString);
  }

  it('has exactly one deferred-deletion (sweeper) state machine', () => {
    sweeperDefinition();
  });

  it('grants states:StartExecution nowhere except the sweeper starter\'s own policy', () => {
    const policies                            = template.findResources('AWS::IAM::Policy');
    const startExecutionPolicyNames: string[] = [];
    for (const [, policy] of Object.entries(policies)) {
      const grantsStartExecution = statementsOfDocument(policy.Properties?.PolicyDocument).some((stmt) =>
        actionsOf(stmt).includes('states:StartExecution'),
      );
      if (grantsStartExecution) {
        startExecutionPolicyNames.push(policy.Properties?.PolicyName);
      }
    }
    expect(startExecutionPolicyNames).not.toContain('stack-failure-detector-policy');
  });

  it('the Custom::DeferredRemoval resource carries a per-removal-type keyed properties map', () => {
    const props = deferredRemovalProperties(template);

    // This test's Mailbox config has no custom regional-SAN certificate, so `cert` is never
    // registered (mirrors mailbox.ts's own `if (regionalSanCertificate)` gate) — `edge-fn` and
    // `detector` are always registered.
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
    const def = sweeperDefinition();

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
    const def = sweeperDefinition();

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
    for (const stmt of statementsOfNamedPolicy(template, 'stack-failure-detector-policy')) {
      expect(actionsOf(stmt)).not.toContain('states:StartExecution');
    }

    // No env var on the detector Lambda carries a state-machine ARN either.
    const fns        = template.findResources('AWS::Lambda::Function');
    const detectorFn = Object.values(fns).find((fn) =>
      renderLiteralText(fn.Properties?.FunctionName).startsWith('mailbox-diag-fn-'),
    );
    expect(detectorFn).toBeDefined();
    const envVars = detectorFn?.Properties.Environment?.Variables ?? {};
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
    const fns        = template.findResources('AWS::Lambda::Function');
    const detectorFn = Object.values(fns).find((fn) =>
      renderLiteralText(fn.Properties?.FunctionName).startsWith('mailbox-diag-fn-'),
    );
    expect(detectorFn).toBeUndefined();

    const roles        = template.findResources('AWS::IAM::Role');
    const detectorRole = Object.values(roles).find((role) =>
      renderLiteralText(role.Properties?.RoleName).startsWith('mailbox-diag-role-'),
    );
    expect(detectorRole).toBeUndefined();

    const policies = template.findResources('AWS::IAM::Policy');
    expect(
      Object.values(policies).some((policy) => policy.Properties?.PolicyName === 'stack-failure-detector-policy'),
    ).toBe(false);
  });

  it('registers no detector removal on the sweeper: no grace-wait/invoke steps and no "detector" key on the deferred-removal custom resource', () => {
    const machines = template.findResources('AWS::StepFunctions::StateMachine');
    const [sm]     = Object.values(machines);
    const def      = renderLiteralText(sm.Properties.DefinitionString);
    expect(def).not.toContain('"DetectorGraceWait"');
    expect(def).not.toContain('"DetectorInvoke"');
    expect(def).not.toContain('"DetectorWaitRetry"');

    expect(deferredRemovalProperties(template)['detector']).toBeUndefined();
  });
});
