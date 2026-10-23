/// <reference types="jest" />

/**
 * TrackedUpdateTriggers: the trigger that runs the updater on every deploy.
 *
 * The deploy-end trigger must carry the tracking condition, because under pinned granularity the
 * condition is false and it must not exist. It must re-fire on every deploy, and it must wait for
 * what it is told to wait for, or it scans a half-deployed stack.
 */

import { Template }                                                              from 'aws-cdk-lib/assertions';
import { Code, Function as LambdaFunction, Runtime }                             from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, CfnCondition, CfnResource, Fn, Stack }   from 'aws-cdk-lib';
import * as t                                                                    from 'typanion';

import { resourcesOfType }                                                       from '../../../__tests__/template-resources';
import { TrackedUpdateTriggers }                                                 from '../tracked-update-triggers';

const isDeployEndProperties = t.isPartial({ Nonce: t.isString() });

interface TriggersFixture {
  readonly stack:      Stack;
  readonly triggers:   TrackedUpdateTriggers;
  readonly isTracking: CfnCondition;
}

function build(): TriggersFixture {
  const stack      = new Stack(new App(), 'TestStack', {
    env:         { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const updater    = new LambdaFunction(stack, 'updater', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });
  const isTracking = new CfnCondition(stack, 'is-tracking', { expression: Fn.conditionEquals('a', 'a') });
  const triggers   = new TrackedUpdateTriggers(stack, 'triggers', { updater, isTracking });

  return { stack, triggers, isTracking };
}

function synthesize(): Template {
  return Template.fromStack(build().stack);
}

describe('TrackedUpdateTriggers', () => {
  it('fires a deploy-end custom resource that CloudFormation may take ten minutes to answer', () => {
    synthesize().hasResourceProperties('Custom::DeployEndTrigger', { ServiceTimeout: '600' });
  });

  it('changes the deploy-end properties on every synthesis so the trigger fires on every deploy', () => {
    const nonceOf = (template: Template): unknown => resourcesOfType(template, 'Custom::DeployEndTrigger', isDeployEndProperties)[0].properties.Nonce;
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_700_000_000_000);
      const first = nonceOf(synthesize());
      jest.setSystemTime(1_700_000_000_001);
      const second = nonceOf(synthesize());

      expect(first).toBe('1700000000000');
      expect(second).toBe('1700000000001');
    } finally {
      jest.useRealTimers();
    }
  });

  it('gates the deploy-end trigger on the tracking condition', () => {
    const { stack, isTracking } = build();
    const resources             = Object.values(Template.fromStack(stack).findResources('Custom::DeployEndTrigger'));

    expect(resources).not.toHaveLength(0);
    resources.forEach((resource) => expect(resource.Condition).toBe(stack.resolve(isTracking.logicalId)));
  });

  it('leaves the updater function outside the gate', () => {
    const functions = Object.values(synthesize().findResources('AWS::Lambda::Function'));

    expect(functions).toHaveLength(1);
    expect(functions[0].Condition).toBeUndefined();
  });

  it('makes the deploy-end trigger wait for a dependency it is told to wait for', () => {
    const { stack, triggers } = build();
    triggers.waitFor(new CfnResource(stack, 'awaited', { type: 'Custom::Awaited' }));

    const template           = Template.fromStack(stack);
    const [awaitedLogicalId] = Object.keys(template.findResources('Custom::Awaited'));
    const [deployEnd]        = Object.values(template.findResources('Custom::DeployEndTrigger'));
    expect(deployEnd.DependsOn).toContain(awaitedLogicalId);
  });
});
