/// <reference types="jest" />

/**
 * StackFailureDetectorRemoval: the grants, `ResourceProperties` entry and state-machine steps for
 * sweeping the detector's rule, function and role as one removal. The role's grants are scoped to
 * its own ARN because IAM role deletion takes no tag condition, and the grace wait is what gives
 * the detector time to report a failed stack before the sweeper tears it down.
 */

import { ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }               from 'aws-cdk-lib';

import {
  newDetectorRemoval,
  newTestStack,
  renderRemovalChain,
  resolveStatements,
  stateBodyOf,
} from './sweeper-helpers';

describe('StackFailureDetectorRemoval', () => {
  const stackGuid            = { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] };
  const idKey                = `aws:ResourceTag/${ServerlessInboxTagKeys.rootStackId}`;
  const ownedById            = { StringEquals: { [idKey]: stackGuid } };
  const ownedByNameWithoutId = {
    StringEquals: { [`aws:ResourceTag/${ServerlessInboxTagKeys.rootStack}`]: { Ref: 'AWS::StackName' } },
    Null: { [idKey]: 'true' },
  };
  const anyRule              = {
    'Fn::Join': ['', ['arn:aws:events:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':rule/*']],
  };
  const anyRegionalFunction  = {
    'Fn::Join': ['', ['arn:aws:lambda:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':function:*']],
  };

  it('scopes rule and function deletion by the root-stack tag and role deletion by the role\'s own ARN', () => {
    const stack             = newTestStack('DetectorGrantsStack');
    const { removal, role } = newDetectorRemoval(stack);

    const statements = resolveStatements(stack, removal.grantStatements());

    const roleArn = stack.resolve(role.roleArn);
    expect(statements).toEqual([
      {
        Action: ['events:DescribeRule', 'events:ListTargetsByRule', 'events:ListTagsForResource'],
        Effect: 'Allow',
        Resource: anyRule,
      },
      { Action: ['events:RemoveTargets', 'events:DeleteRule'], Effect: 'Allow', Resource: anyRule, Condition: ownedById },
      { Action: ['events:RemoveTargets', 'events:DeleteRule'], Effect: 'Allow', Resource: anyRule, Condition: ownedByNameWithoutId },
      { Action: 'lambda:GetFunction', Effect: 'Allow', Resource: anyRegionalFunction },
      { Action: 'lambda:DeleteFunction', Effect: 'Allow', Resource: anyRegionalFunction, Condition: ownedById },
      { Action: 'lambda:DeleteFunction', Effect: 'Allow', Resource: anyRegionalFunction, Condition: ownedByNameWithoutId },
      { Action: 'iam:ListRoleTags', Effect: 'Allow', Resource: roleArn },
      { Action: ['iam:DeleteRolePolicy', 'iam:DeleteRole'], Effect: 'Allow', Resource: roleArn },
    ]);
  });

  it('puts the rule, function and role of the detector in its ResourceProperties entry', () => {
    const stack                   = newTestStack('DetectorPropertiesStack');
    const { removal, rule, role } = newDetectorRemoval(stack);

    expect(stack.resolve(removal.crProperties())).toEqual({
      ruleArn: stack.resolve(rule.ruleArn),
      ruleTargetId: 'Target0',
      detectorFnArn: 'arn:aws:lambda:us-west-2:123456789012:function:mailbox-diag-fn-test',
      detectorRoleArn: stack.resolve(role.roleArn),
      detectorRolePolicyName: 'stack-failure-detector-policy',
    });
  });

  it('waits 15 minutes by default before the first invocation, then retries without waiting again', () => {
    const stack = newTestStack('DetectorDefaultGraceStack');

    const definition = renderRemovalChain(stack, newDetectorRemoval(stack).removal);

    expect(stateBodyOf(definition, 'DetectorHasTarget')).toContain('"Next":"DetectorGraceWait"');
    expect(stateBodyOf(definition, 'DetectorGraceWait')).toContain('"Seconds":900');
    expect(stateBodyOf(definition, 'DetectorGraceWait')).toContain('"Next":"DetectorInvoke"');
    expect(stateBodyOf(definition, 'DetectorWaitRetry')).toContain('"Next":"DetectorInvoke"');
  });

  it('waits the grace period it is given', () => {
    const stack = newTestStack('DetectorCustomGraceStack');

    const definition = renderRemovalChain(stack, newDetectorRemoval(stack, Duration.minutes(2)).removal);

    expect(stateBodyOf(definition, 'DetectorGraceWait')).toContain('"Seconds":120');
  });

  it('skips to the next step when no detector is in the execution input, else sweeps it for the root stack', () => {
    const stack = newTestStack('DetectorChainStack');

    const definition = renderRemovalChain(stack, newDetectorRemoval(stack).removal);

    expect(definition).toContain('"StartAt":"DetectorHasTarget"');
    expect(stateBodyOf(definition, 'DetectorHasTarget')).toContain('"Variable":"$.toSweep.detector"');
    expect(stateBodyOf(definition, 'DetectorHasTarget')).toContain('"Default":"Done"');
    const invoke = stateBodyOf(definition, 'DetectorInvoke');
    expect(invoke).toContain('"ruleArn.$":"$.toSweep.detector.ruleArn"');
    expect(invoke).toContain('"detectorRolePolicyName.$":"$.toSweep.detector.detectorRolePolicyName"');
    expect(invoke).toContain('"rootStackName":"DetectorChainStack"');
    expect(invoke).toContain('"rootStackId":');
  });
});
