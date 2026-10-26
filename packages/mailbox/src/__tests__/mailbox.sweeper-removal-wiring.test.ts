/// <reference types="jest" />

/**
 * How `Mailbox` wires the sweeper's removals: the `Custom::DeferredRemoval` custom resource carries
 * one keyed entry per registered removal, the detector entry points at the detector's own role and
 * function, and turning stack-failure sending off registers no detector at all. What the sweeper's
 * state machine and the detector's policies contain is pinned in their own tests.
 * Synthesizes the full `Mailbox` construct at its real position (not standalone units) so this proves
 * the wiring that ships, not just that the pieces individually compile.
 */

import { renderLiteralText }                                    from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                             from 'aws-cdk-lib/assertions';
import { App, BootstraplessSynthesizer, Stack }                 from 'aws-cdk-lib';
import * as t                                                   from 'typanion';

import { Mailbox }                                              from '../mailbox';
import { SendStackFailuresMode }                                from '../platform/ops/stack-failure-detection';

import { createMockAuthProvider, TEST_ARTIFACT_CONTEXT }        from './mailbox-helpers';
import { isTemplateValue, resourcesOfType, type TemplateValue } from './template-resources';

const isDeferredRemovalProperties = t.isDict(isTemplateValue);
const isPolicyProperties          = t.isPartial({ PolicyName: t.isOptional(isTemplateValue) });
const isRoleProperties            = t.isPartial({ RoleName: t.isOptional(isTemplateValue) });
const isLambdaFunctionProperties  = t.isPartial({ FunctionName: t.isOptional(isTemplateValue) });

function synthMailboxTemplate(sendStackFailures?: SendStackFailuresMode): Template {
  const app   = new App({
    context: { 'serverlessinbox:artifacts': TEST_ARTIFACT_CONTEXT },
  });
  const stack = new Stack(app, `TestMailboxSweeperRemovalWiring-${sendStackFailures ?? 'default'}`, {
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

function detectorRolesOf(template: Template): ReturnType<typeof resourcesOfType<{ RoleName?: TemplateValue }>> {
  return resourcesOfType(template, 'AWS::IAM::Role', isRoleProperties).filter((role) =>
    renderLiteralText(role.properties.RoleName).startsWith('mailbox-diag-role-'),
  );
}

function detectorFunctionsOf(template: Template): ReturnType<typeof resourcesOfType<{ FunctionName?: TemplateValue }>> {
  return resourcesOfType(template, 'AWS::Lambda::Function', isLambdaFunctionProperties).filter((lambdaFunction) =>
    renderLiteralText(lambdaFunction.properties.FunctionName).startsWith('mailbox-diag-fn-'),
  );
}

describe('Mailbox: sweeper removal wiring', () => {
  let template: Template;

  beforeAll(() => {
    template = synthMailboxTemplate();
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

  it('the detector entry references the detector\'s own role and function by their ARNs', () => {
    const roles     = detectorRolesOf(template);
    const functions = detectorFunctionsOf(template);
    expect(roles).toHaveLength(1);
    expect(functions).toHaveLength(1);

    const detector = deferredRemovalProperties(template)['detector'];

    expect(detector).toMatchObject({
      detectorRoleArn: { 'Fn::GetAtt': [roles[0].logicalId, 'Arn'] },
      detectorFnArn:   { 'Fn::GetAtt': [functions[0].logicalId, 'Arn'] },
    });
  });
});

describe('Mailbox: sweeper removal wiring — sendStackFailures disabled', () => {
  let template: Template;

  beforeAll(() => {
    template = synthMailboxTemplate(SendStackFailuresMode.DISABLED);
  });

  it('synthesizes no detector resources at all — the all-or-nothing sweep-target property collapses to undefined', () => {
    expect(detectorFunctionsOf(template)).toEqual([]);
    expect(detectorRolesOf(template)).toEqual([]);
    expect(
      resourcesOfType(template, 'AWS::IAM::Policy', isPolicyProperties).some((policy) => policy.properties.PolicyName === 'stack-failure-detector-policy'),
    ).toBe(false);
  });

  it('registers no "detector" key on the deferred-removal custom resource', () => {
    expect(deferredRemovalProperties(template)['detector']).toBeUndefined();
    expect(propertyNamesOf(deferredRemovalProperties(template)['edge-fn'])).toEqual(['edgeFnArn']);
  });
});
