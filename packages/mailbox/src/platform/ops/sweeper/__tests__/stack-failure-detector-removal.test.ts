/// <reference types="jest" />

/**
 * StackFailureDetectorRemoval: the grants, `ResourceProperties` entry and state-machine steps for
 * sweeping the detector's rule, function and role as one removal. The role's grants are scoped to
 * its own ARN because IAM role deletion takes no tag condition, and the grace wait is what gives
 * the detector time to report a failed stack before the sweeper tears it down.
 */

import { Duration }     from 'aws-cdk-lib';

import { stateBodyOf }  from '../../../../__tests__/state-machine-helpers';
import { newTestStack } from '../../../__tests__/platform-helpers';

import {
  guardEntryOf,
  nameOfStateWhere,
  newDetectorRemoval,
  OWNED_BY_STACK_ID,
  OWNED_BY_STACK_NAME_WITHOUT_ID,
  renderRemovalChain,
  resolveStatements,
  resolveValue,
  startStateOf,
  stateOf,
  statusTargetOf,
} from './sweeper-helpers';

describe('StackFailureDetectorRemoval', () => {
  const anyRule             = {
    'Fn::Join': [
      '',
      ['arn:', { Ref: 'AWS::Partition' }, ':events:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':rule/*'],
    ],
  };
  const anyRegionalFunction = {
    'Fn::Join': [
      '',
      ['arn:', { Ref: 'AWS::Partition' }, ':lambda:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':function:*'],
    ],
  };

  it('scopes rule and function deletion by the root-stack tag and role deletion by the role\'s own ARN', () => {
    const stack             = newTestStack('DetectorGrantsStack');
    const { removal, role } = newDetectorRemoval(stack);

    const statements = resolveStatements(stack, removal.grantStatements());

    const roleArn = resolveValue(stack, role.roleArn);
    expect(statements).toEqual([
      {
        Action:   ['events:DescribeRule', 'events:ListTargetsByRule', 'events:ListTagsForResource'],
        Effect:   'Allow',
        Resource: anyRule,
      },
      { Action: ['events:RemoveTargets', 'events:DeleteRule'], Effect: 'Allow', Resource: anyRule, Condition: OWNED_BY_STACK_ID },
      { Action: ['events:RemoveTargets', 'events:DeleteRule'], Effect: 'Allow', Resource: anyRule, Condition: OWNED_BY_STACK_NAME_WITHOUT_ID },
      { Action: 'lambda:GetFunction', Effect: 'Allow', Resource: anyRegionalFunction },
      { Action: 'lambda:DeleteFunction', Effect: 'Allow', Resource: anyRegionalFunction, Condition: OWNED_BY_STACK_ID },
      { Action: 'lambda:DeleteFunction', Effect: 'Allow', Resource: anyRegionalFunction, Condition: OWNED_BY_STACK_NAME_WITHOUT_ID },
      { Action: 'iam:ListRoleTags', Effect: 'Allow', Resource: roleArn },
      { Action: ['iam:DeleteRolePolicy', 'iam:DeleteRole'], Effect: 'Allow', Resource: roleArn },
    ]);
  });

  it('puts the rule, function and role of the detector in its ResourceProperties entry', () => {
    const stack                               = newTestStack('DetectorPropertiesStack');
    const { removal, stackFailedEvent, role } = newDetectorRemoval(stack);

    expect(resolveValue(stack, removal.crProperties())).toEqual({
      ruleArn:                resolveValue(stack, stackFailedEvent.ruleArn),
      ruleTargetId:           'Target0',
      detectorFnArn:          'arn:aws:lambda:us-west-2:123456789012:function:mailbox-diag-fn-test',
      detectorRoleArn:        resolveValue(stack, role.roleArn),
      detectorRolePolicyName: 'stack-failure-detector-policy',
    });
  });

  it('waits 15 minutes by default before the first invocation, then retries without waiting again', () => {
    const stack = newTestStack('DetectorDefaultGraceStack');

    const definition = renderRemovalChain(stack, newDetectorRemoval(stack).removal);

    const grace  = guardEntryOf(definition);
    const invoke = nameOfStateWhere(definition, (state) => state.Type === 'Task');

    expect(stateBodyOf(definition, grace)).toContain('"Seconds":900');
    expect(stateOf(definition, grace).Next).toBe(invoke);
    expect(stateOf(definition, statusTargetOf(definition, 'RETRY')).Next).toBe(invoke);
  });

  it('waits the grace period it is given', () => {
    const stack = newTestStack('DetectorCustomGraceStack');

    const definition = renderRemovalChain(stack, newDetectorRemoval(stack, Duration.minutes(2)).removal);

    expect(stateBodyOf(definition, guardEntryOf(definition))).toContain('"Seconds":120');
  });

  it('skips to the next step when no detector is in the execution input, else sweeps it for the root stack', () => {
    const stack = newTestStack('DetectorChainStack');

    const definition = renderRemovalChain(stack, newDetectorRemoval(stack).removal);

    const guard  = startStateOf(definition);
    const invoke = nameOfStateWhere(definition, (state) => state.Type === 'Task');

    expect(stateBodyOf(definition, guard)).toContain('"Variable":"$.toSweep.detector"');
    expect(stateOf(definition, guard).Default).toBe('Done');
    expect(stateBodyOf(definition, invoke)).toContain('"target.$":"$.toSweep.detector"');
    expect(stateBodyOf(definition, invoke)).toContain('"rootStackName":"DetectorChainStack"');
    expect(stateBodyOf(definition, invoke)).toContain('"rootStackId":');
  });
});
