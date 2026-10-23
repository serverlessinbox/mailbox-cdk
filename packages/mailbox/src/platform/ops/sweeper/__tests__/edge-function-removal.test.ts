/// <reference types="jest" />

/**
 * EdgeFunctionRemoval: the grants, `ResourceProperties` entry and state-machine steps for sweeping
 * a Lambda@Edge function. Edge functions live in us-east-1 whatever the stack's region, so a grant
 * scoped to the stack's own region would deny every sweep; deletion stays gated on the root-stack
 * tag so a function another stack owns is never deleted.
 */

import { stateBodyOf }  from '../../../../__tests__/state-machine-helpers';
import { newTestStack } from '../../../__tests__/platform-helpers';

import {
  newEdgeFunctionRemoval,
  OWNED_BY_STACK_ID,
  OWNED_BY_STACK_NAME_WITHOUT_ID,
  nameOfStateWhere,
  renderRemovalChain,
  resolveStatements,
  startStateOf,
  stateOf,
} from './sweeper-helpers';

describe('EdgeFunctionRemoval', () => {
  const anyUsEast1Function = {
    'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':lambda:us-east-1:', { Ref: 'AWS::AccountId' }, ':function:*']],
  };

  it('reads functions in us-east-1 unconditioned and deletes them there only when the root stack owns them, by id or by name without an id tag', () => {
    const stack = newTestStack('EdgeFunctionGrantsStack');

    const statements = resolveStatements(stack, newEdgeFunctionRemoval(stack).grantStatements());

    expect(statements).toEqual([
      { Action: 'lambda:GetFunction', Effect: 'Allow', Resource: anyUsEast1Function },
      { Action: 'lambda:DeleteFunction', Effect: 'Allow', Resource: anyUsEast1Function, Condition: OWNED_BY_STACK_ID },
      { Action: 'lambda:DeleteFunction', Effect: 'Allow', Resource: anyUsEast1Function, Condition: OWNED_BY_STACK_NAME_WITHOUT_ID },
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
    const guard      = startStateOf(definition);
    const invoke     = nameOfStateWhere(definition, (state) => state.Type === 'Task');

    expect(stateBodyOf(definition, guard)).toContain('"Variable":"$.toSweep.edge-fn"');
    expect(stateOf(definition, guard).Default).toBe('Done');
    expect(stateOf(definition, guard).Choices?.[0]?.Next).toBe(invoke);
    expect(stateBodyOf(definition, invoke)).toContain('"edgeFnArn.$":"$.toSweep.edge-fn.edgeFnArn"');
    expect(stateBodyOf(definition, invoke)).toContain('"rootStackName":"EdgeFunctionChainStack"');
    expect(stateBodyOf(definition, invoke)).toContain('"rootStackId":');
  });
});
