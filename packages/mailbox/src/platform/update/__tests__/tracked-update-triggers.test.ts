/// <reference types="jest" />

/**
 * TrackedUpdateTriggers: the triggers that run the updater on every deploy and on a schedule.
 *
 * Everything in the subtree must carry the tracking condition, because under pinned granularity
 * the condition is false and these resources must not exist; an ungated rule keeps firing a
 * schedule the owner switched off. The deploy-end trigger must re-fire on every deploy, and it
 * must wait for what it is told to wait for, or it scans a half-deployed stack.
 */

import { Template }                                                                      from 'aws-cdk-lib/assertions';
import { Code, Function as LambdaFunction, Runtime }                                     from 'aws-cdk-lib/aws-lambda';
import { App, BootstraplessSynthesizer, CfnCondition, CfnResource, Duration, Fn, Stack } from 'aws-cdk-lib';

import { TrackedUpdateTriggers }                                                         from '../tracked-update-triggers';

const TRACKING_CONDITION = 'IsTracking';

interface TriggersFixture {
  readonly stack: Stack;
  readonly triggers: TrackedUpdateTriggers;
}

function build(updateInterval: Duration): TriggersFixture {
  const stack      = new Stack(new App(), 'TestStack', {
    env: { account: '123456789012', region: 'us-west-2' },
    synthesizer: new BootstraplessSynthesizer(),
  });
  const updater    = new LambdaFunction(stack, 'updater', { runtime: Runtime.NODEJS_20_X, handler: 'index.handler', code: Code.fromInline('x') });
  const isTracking = new CfnCondition(stack, TRACKING_CONDITION, { expression: Fn.conditionEquals('a', 'a') });

  return { stack, triggers: new TrackedUpdateTriggers(stack, 'triggers', { updater, isTracking, updateInterval }) };
}

function synthesize(updateInterval: Duration): Template {
  return Template.fromStack(build(updateInterval).stack);
}

describe('TrackedUpdateTriggers', () => {
  it('fires a deploy-end custom resource that CloudFormation may take ten minutes to answer', () => {
    synthesize(Duration.hours(6)).hasResourceProperties('Custom::DeployEndTrigger', { ServiceTimeout: '600' });
  });

  it('changes the deploy-end properties on every synthesis so the trigger fires on every deploy', () => {
    const nonceOf = (template: Template): unknown => Object.values(template.findResources('Custom::DeployEndTrigger'))[0].Properties.Nonce;
    jest.useFakeTimers();
    try {
      jest.setSystemTime(1_700_000_000_000);
      const first = nonceOf(synthesize(Duration.hours(6)));
      jest.setSystemTime(1_700_000_000_001);
      const second = nonceOf(synthesize(Duration.hours(6)));

      expect(first).toBe('1700000000000');
      expect(second).toBe('1700000000001');
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs the updater on a schedule at the given interval', () => {
    synthesize(Duration.hours(3)).hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(3 hours)' });
  });

  it.each(['Custom::DeployEndTrigger', 'AWS::Events::Rule', 'AWS::Lambda::Permission'])('gates %s on the tracking condition', (type) => {
    const resources = Object.values(synthesize(Duration.hours(6)).findResources(type));

    expect(resources).not.toHaveLength(0);
    resources.forEach((resource) => expect(resource.Condition).toBe(TRACKING_CONDITION));
  });

  it('leaves the updater function outside the gate', () => {
    const functions = Object.values(synthesize(Duration.hours(6)).findResources('AWS::Lambda::Function'));

    expect(functions).toHaveLength(1);
    expect(functions[0].Condition).toBeUndefined();
  });

  it('makes the deploy-end trigger wait for a dependency it is told to wait for', () => {
    const { stack, triggers } = build(Duration.hours(6));
    triggers.waitFor(new CfnResource(stack, 'awaited', { type: 'Custom::Awaited' }));

    const template           = Template.fromStack(stack);
    const [awaitedLogicalId] = Object.keys(template.findResources('Custom::Awaited'));
    const [deployEnd]        = Object.values(template.findResources('Custom::DeployEndTrigger'));
    expect(deployEnd.DependsOn).toContain(awaitedLogicalId);
  });
});
