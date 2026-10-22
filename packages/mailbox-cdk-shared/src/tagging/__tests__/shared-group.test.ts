/**
 * Pins the shared group of a stack: every caller gets the one group, and the group carries the base tags
 * itself. It is parented on the stack, outside the scope of an aspect registered on a construct below the
 * stack, so a resource created under it is only tagged when the group tags it.
 */

import { Match, Template }        from 'aws-cdk-lib/assertions';
import { CfnQueue }               from 'aws-cdk-lib/aws-sqs';
import { App, Stack }             from 'aws-cdk-lib';

import { getOrCreateSharedGroup } from '../shared-group';

describe('getOrCreateSharedGroup', () => {
  it('creates the group as the stack’s child "shared" and returns it again on every call', () => {
    const stack = new Stack(new App(), 'Root');

    const first  = getOrCreateSharedGroup(stack);
    const second = getOrCreateSharedGroup(stack);

    expect(second).toBe(first);
    expect(stack.node.findChild('shared')).toBe(first);
  });

  it('tags the resources created under the group with the base tags', () => {
    const stack = new Stack(new App(), 'Root');
    new CfnQueue(getOrCreateSharedGroup(stack), 'queue');

    Template.fromStack(stack).hasResourceProperties('AWS::SQS::Queue', {
      Tags: Match.arrayWith([{ Key: 'serverless-inbox:root-stack', Value: { Ref: 'AWS::StackName' } }]),
    });
  });
});
