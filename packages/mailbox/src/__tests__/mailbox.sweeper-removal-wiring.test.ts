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
import * as t                                                                          from 'typanion';

import { Mailbox }                                                                     from '../mailbox';
import { SendStackFailuresMode }                                                       from '../platform/ops/stack-failure-detection';

import { createMockAuthProvider, TEST_ARTIFACT_CONTEXT }                               from './mailbox-helpers';
import { isTemplateValue, resourcesOfType, type TemplateValue }                        from './template-resources';

const isDeferredRemovalProperties = t.isDict(isTemplateValue);
const isStateMachineProperties    = t.isPartial({ DefinitionString: isTemplateValue, StateMachineName: t.isOptional(isTemplateValue) });
const isPolicyProperties          = t.isPartial({ PolicyDocument: t.isOptional(isTemplateValue), PolicyName: t.isOptional(isTemplateValue) });
const isRoleProperties            = t.isPartial({ RoleName: t.isOptional(isTemplateValue) });
const isLambdaFunctionProperties  = t.isPartial({
  FunctionName: t.isOptional(isTemplateValue),
  Environment:  t.isOptional(t.isPartial({ Variables: t.isOptional(t.isDict(isTemplateValue)) })),
});

function synthMailboxTemplate(sendStackFailures?: SendStackFailuresMode): Template {
  const app   = new App({
    context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT },
  });
  const stack = new cdk.Stack(app, `TestMailboxSweeperRemovalWiring-${sendStackFailures ?? 'default'}`, {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });

  new Mailbox(stack, 'mailbox', { authProvider: createMockAuthProvider(), sendStackFailures });

  return Template.fromStack(stack);
}

function deferredRemovalProperties(template: Template): Readonly<Record<string, TemplateValue>> {
  const [resource] = resourcesOfType(template, 'Custom::DeferredRemoval', isDeferredRemovalProperties);
  return resource.properties;
}

/** The property names of one entry of the deferred-removal map: the entry must be an object, and its keys are what the test pins. */
function propertyNamesOf(entry: TemplateValue | undefined): string[] {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error('The deferred-removal entry is not an object');
  }
  return Object.keys(entry);
}

interface RenderedState {
  readonly Type:     string;
  readonly Next?:    string;
  readonly Seconds?: number;
  readonly Choices?: readonly { readonly Next: string; readonly StringEquals?: string }[];
}

interface RenderedMachine {
  readonly States: Readonly<Record<string, RenderedState>>;
}

function parseMachine(definition: string): RenderedMachine {
  return JSON.parse(definition) as RenderedMachine;
}

/** The one Task state of the definition that carries the removal type's payload. The name is read from the definition. */
function invokeOf(definition: string, removalType: string): string {
  const machine = parseMachine(definition);
  const names   = Object.keys(machine.States).filter((name) =>
    machine.States[name].Type === 'Task' && JSON.stringify(machine.States[name]).includes(`"removalType":"${removalType}"`),
  );
  expect(names).toHaveLength(1);
  return names[0];
}

/** The Wait state that the retry loop of `invoke` returns through on RETRY. */
function retryWaitOf(definition: string, invoke: string): string {
  const machine = parseMachine(definition);
  const choice  = machine.States[invoke].Next ?? '';
  const retry   = machine.States[choice].Choices?.find((rule) => rule.StringEquals === 'RETRY');
  expect(retry).toBeDefined();
  return retry?.Next ?? '';
}

describe('Mailbox: sweeper removal wiring', () => {
  let template: Template;

  beforeAll(() => {
    template = synthMailboxTemplate();
  });

  function sweeperDefinition(): string {
    const sweeperMachines = resourcesOfType(template, 'AWS::StepFunctions::StateMachine', isStateMachineProperties).filter((machine) =>
      renderLiteralText(machine.properties.StateMachineName).startsWith('mailbox-sweeper-'),
    );
    expect(sweeperMachines).toHaveLength(1);
    return renderLiteralText(sweeperMachines[0].properties.DefinitionString);
  }

  it('has exactly one deferred-deletion (sweeper) state machine', () => {
    sweeperDefinition();
  });

  it('grants states:StartExecution nowhere except the sweeper starter\'s own policy', () => {
    const startExecutionPolicyNames = resourcesOfType(template, 'AWS::IAM::Policy', isPolicyProperties)
      .filter((policy) =>
        statementsOfDocument(policy.properties.PolicyDocument).some((stmt) => actionsOf(stmt).includes('states:StartExecution')),
      )
      .map((policy) => policy.properties.PolicyName);
    expect(startExecutionPolicyNames).not.toContain('stack-failure-detector-policy');
  });

  it('the Custom::DeferredRemoval resource carries a per-removal-type keyed properties map', () => {
    const props = deferredRemovalProperties(template);

    // This test's Mailbox config has no custom regional-SAN certificate, so `cert` is never
    // registered (mirrors mailbox.ts's own `if (regionalSanCertificate)` gate) — `edge-fn` and
    // `detector` are always registered.
    expect(propertyNamesOf(props['edge-fn'])).toEqual(['edgeFnArn']);
    expect(propertyNamesOf(props['detector'])).toEqual([
      'ruleArn',
      'ruleTargetId',
      'detectorFnArn',
      'detectorRoleArn',
      'detectorRolePolicyName',
    ]);
    expect(props.cert).toBeUndefined();
  });

  it('the detector entry references the created-anew role and function (construct ids detector-role-v2 and detector-v2) by their ARNs', () => {
    const roles     = resourcesOfType(template, 'AWS::IAM::Role', isRoleProperties).filter((role) =>
      renderLiteralText(role.properties.RoleName).startsWith('mailbox-diag-role-'),
    );
    const functions = resourcesOfType(template, 'AWS::Lambda::Function', isLambdaFunctionProperties).filter((lambdaFunction) =>
      renderLiteralText(lambdaFunction.properties.FunctionName).startsWith('mailbox-diag-fn-'),
    );
    expect(roles).toHaveLength(1);
    expect(functions).toHaveLength(1);
    const roleLogicalId     = roles[0].logicalId;
    const functionLogicalId = functions[0].logicalId;
    expect(roleLogicalId).toMatch(/infradetectorrolev2[0-9A-F]{8}$/);
    expect(functionLogicalId).toMatch(/infradetectorv2[0-9A-F]{8}$/);

    const detector = deferredRemovalProperties(template)['detector'];

    expect(detector).toMatchObject({
      detectorRoleArn: { 'Fn::GetAtt': [roleLogicalId, 'Arn'] },
      detectorFnArn:   { 'Fn::GetAtt': [functionLogicalId, 'Arn'] },
    });
  });

  it('the state machine definition contains steps contributed by each registered removal', () => {
    const definition = sweeperDefinition();

    // The cert removal is not registered in this config (see the props case above), so the definition
    // carries the steps of edge-fn and detector only.

    // Edge-fn is always registered.
    expect(parseMachine(definition).States[retryWaitOf(definition, invokeOf(definition, 'edge-fn'))].Type).toBe('Wait');
    // Detector contributes its own Invoke/retry-loop states too (enabled by default).
    expect(parseMachine(definition).States[retryWaitOf(definition, invokeOf(definition, 'detector'))].Type).toBe('Wait');
    // Self-cleanup tail still present after every removal succeeds.
    expect(definition).toContain('"self-cleanup-delete-worker"');
    expect(definition).toContain('"self-cleanup-delete-state-machine"');
  });

  it('the detector\'s grace-period Wait state comes from its own removal, not shared retry logic', () => {
    const definition = sweeperDefinition();

    const machine = parseMachine(definition);

    // Only the detector removal contributes a grace-period wait: the definition has one 15-minute Wait,
    // and it leads into the detector's invoke, so cert and edge-fn have none.
    const graceWaits = Object.keys(machine.States).filter((name) => machine.States[name].Seconds === 15 * 60);
    expect(graceWaits).toHaveLength(1);
    expect(machine.States[graceWaits[0]].Next).toBe(invokeOf(definition, 'detector'));

    // The detector's retry loop still waits the 5-minute retry interval, distinct from the grace wait.
    expect(machine.States[retryWaitOf(definition, invokeOf(definition, 'detector'))].Seconds).toBe(5 * 60);
  });

  it('the stack-failure detector\'s own policies carry no sweeper-related grant', () => {
    for (const stmt of statementsOfNamedPolicy(template, 'stack-failure-detector-policy')) {
      expect(actionsOf(stmt)).not.toContain('states:StartExecution');
    }

    // No env var on the detector Lambda carries a state-machine ARN either.
    const detectorFn = resourcesOfType(template, 'AWS::Lambda::Function', isLambdaFunctionProperties).find((lambdaFunction) =>
      renderLiteralText(lambdaFunction.properties.FunctionName).startsWith('mailbox-diag-fn-'),
    );
    expect(detectorFn).toBeDefined();
    const envVars = detectorFn?.properties.Environment?.Variables ?? {};
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
    const detectorFn = resourcesOfType(template, 'AWS::Lambda::Function', isLambdaFunctionProperties).find((lambdaFunction) =>
      renderLiteralText(lambdaFunction.properties.FunctionName).startsWith('mailbox-diag-fn-'),
    );
    expect(detectorFn).toBeUndefined();

    const detectorRole = resourcesOfType(template, 'AWS::IAM::Role', isRoleProperties).find((role) =>
      renderLiteralText(role.properties.RoleName).startsWith('mailbox-diag-role-'),
    );
    expect(detectorRole).toBeUndefined();

    expect(
      resourcesOfType(template, 'AWS::IAM::Policy', isPolicyProperties).some((policy) => policy.properties.PolicyName === 'stack-failure-detector-policy'),
    ).toBe(false);
  });

  it('registers no detector removal on the sweeper: no grace-wait/invoke steps and no "detector" key on the deferred-removal custom resource', () => {
    const [stateMachine] = resourcesOfType(template, 'AWS::StepFunctions::StateMachine', isStateMachineProperties);
    const definition     = renderLiteralText(stateMachine.properties.DefinitionString);
    const states         = Object.values(parseMachine(definition).States);
    expect(states.some((state) => JSON.stringify(state).includes('"removalType":"detector"'))).toBe(false);
    expect(states.some((state) => state.Seconds === 15 * 60)).toBe(false);

    expect(deferredRemovalProperties(template)['detector']).toBeUndefined();
  });
});
