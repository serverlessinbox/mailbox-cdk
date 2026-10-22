/// <reference types="jest" />

/**
 * Pins that the aspect puts a condition on every resource of the subtree it is added to and on nothing
 * outside it. A resource that misses the condition is deployed even when the feature is off.
 */

import { Template }               from 'aws-cdk-lib/assertions';
import * as cdk                   from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import { GateOnConditionAspect }  from '../gate-on-condition-aspect';

function topic(scope: Construct, id: string): cdk.CfnResource {
  return new cdk.CfnResource(scope, id, { type: 'AWS::SNS::Topic' });
}

describe('GateOnConditionAspect', () => {
  const stack     = new cdk.Stack(new cdk.App(), 'TestStack');
  const condition = new cdk.CfnCondition(stack, 'IsEnabled', { expression: cdk.Fn.conditionEquals('a', 'b') });
  const subtree   = new Construct(stack, 'feature');
  const nested    = new Construct(subtree, 'nested');

  topic(subtree, 'direct');
  topic(nested, 'deep');
  topic(stack, 'outside');
  cdk.Aspects.of(subtree).add(new GateOnConditionAspect(condition));

  const resources   = Template.fromStack(stack).toJSON().Resources as Record<string, { Condition?: string }>;
  const conditionOf = (idPart: string): string | undefined => {
    const logicalId = Object.keys(resources).find((key) => key.includes(idPart));
    return resources[logicalId ?? ''].Condition;
  };

  it('puts the condition on every resource of the subtree, nested ones included', () => {
    expect(conditionOf('direct')).toBe('IsEnabled');
    expect(conditionOf('deep')).toBe('IsEnabled');
  });

  it('leaves resources outside the subtree ungated', () => {
    expect(conditionOf('outside')).toBeUndefined();
  });
});
