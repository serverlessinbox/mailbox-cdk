/// <reference types="jest" />

/**
 * EdgeFunctionRemoval: the grants, `ResourceProperties` entry and state-machine steps for sweeping
 * a Lambda@Edge function. Edge functions live in us-east-1 whatever the stack's region, so a grant
 * scoped to the stack's own region would deny every sweep; deletion stays gated on the root-stack
 * tag so a function another stack owns is never deleted.
 */

import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import {
  newEdgeFunctionRemoval,
  newTestStack,
  renderRemovalChain,
  resolveStatements,
  stateBodyOf,
} from './sweeper-helpers';

describe('EdgeFunctionRemoval', () => {
  const anyUsEast1Function = {
    'Fn::Join': ['', ['arn:aws:lambda:us-east-1:', { Ref: 'AWS::AccountId' }, ':function:*']],
  };

  const stackGuid = { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] };
  const idKey = `aws:ResourceTag/${ServerlessInboxTagKeys.rootStackId}`;
  const ownedById = { StringEquals: { [idKey]: stackGuid } };
  const ownedByNameWithoutId = {
    StringEquals: { [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: { Ref: 'AWS::StackName' } },
    Null: { [idKey]: 'true' },
  };

  it('reads functions in us-east-1 unconditioned and deletes them there only when the root stack owns them, by id or by name without an id tag', () => {
    const stack = newTestStack('EdgeFunctionGrantsStack');

    const statements = resolveStatements(stack, newEdgeFunctionRemoval(stack).grantStatements());

    expect(statements).toEqual([
      { Action: 'lambda:GetFunction', Effect: 'Allow', Resource: anyUsEast1Function },
      { Action: 'lambda:DeleteFunction', Effect: 'Allow', Resource: anyUsEast1Function, Condition: ownedById },
      { Action: 'lambda:DeleteFunction', Effect: 'Allow', Resource: anyUsEast1Function, Condition: ownedByNameWithoutId },
    ]);
  });

  it('puts the function ARN in its ResourceProperties entry', () => {
    const stack = newTestStack('EdgeFunctionPropertiesStack');

    expect(newEdgeFunctionRemoval(stack).crProperties()).toEqual({
      edgeFnArn: 'arn:aws:lambda:us-east-1:123456789012:function:edge-fn',
    });
  });

  it('skips to the next step when no function is in the execution input, else sweeps it for the root stack', () => {
    const stack = newTestStack('EdgeFunctionChainStack');

    const definition = renderRemovalChain(stack, newEdgeFunctionRemoval(stack));

    expect(definition).toContain('"StartAt":"EdgeFnHasTarget"');
    expect(stateBodyOf(definition, 'EdgeFnHasTarget')).toContain('"Variable":"$.toSweep.edge-fn"');
    expect(stateBodyOf(definition, 'EdgeFnHasTarget')).toContain('"Default":"Done"');
    expect(stateBodyOf(definition, 'EdgeFnInvoke')).toContain('"edgeFnArn.$":"$.toSweep.edge-fn.edgeFnArn"');
    expect(stateBodyOf(definition, 'EdgeFnInvoke')).toContain('"rootStackName":"EdgeFunctionChainStack"');
    expect(stateBodyOf(definition, 'EdgeFnInvoke')).toContain('"rootStackId":');
  });
});
