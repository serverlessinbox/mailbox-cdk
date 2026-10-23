/// <reference types="jest" />

/**
 * StackFailureDetectorRemoval: the grants, `ResourceProperties` entry and state-machine steps for
 * sweeping the detector's rule, function and role as one removal. The role's grants are scoped to
 * its own ARN because IAM role deletion takes no tag condition, and the grace wait is what gives
 * the detector time to report a failed stack before the sweeper tears it down.
 */

import { StackIdentity } from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }      from 'aws-cdk-lib';

import { stateBodyOf }   from '../../../../__tests__/state-machine-helpers';
import { newTestStack }  from '../../../__tests__/platform-helpers';

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

/** The stack id the pattern test evaluates against: its guid prefix is `a1b2c3d4`. */
const SAMPLE_STACK_ID = 'arn:aws:cloudformation:us-west-2:123456789012:stack/DetectorGrantsStack/a1b2c3d4-0000-4000-8000-000000000001';

const SAMPLE_PSEUDO_PARAMETERS: Readonly<Record<string, string>> = {
  'AWS::Partition': 'aws',
  'AWS::AccountId': '123456789012',
  'AWS::Region':    'us-west-2',
  'AWS::StackId':   SAMPLE_STACK_ID,
};

/** Evaluates the string intrinsics a role ARN pattern renders to, with the sample stack's pseudo parameters. */
function evaluateString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  const node = value as Record<string, unknown>;
  if ('Ref' in node) {
    return SAMPLE_PSEUDO_PARAMETERS[node.Ref as string];
  }
  if ('Fn::Join' in node) {
    const [separator, parts] = node['Fn::Join'] as [string, unknown[]];
    return parts.map((part) => evaluateString(part)).join(separator);
  }
  if ('Fn::Select' in node) {
    const [index, split] = node['Fn::Select'] as [number, unknown];
    return evaluateSplit(split)[index];
  }
  throw new Error(`Unsupported intrinsic in a role ARN pattern: ${JSON.stringify(value)}`);
}

function evaluateSplit(value: unknown): string[] {
  const [separator, source] = (value as Record<'Fn::Split', [string, unknown]>)['Fn::Split'];
  return evaluateString(source).split(separator);
}

/** Whether `arn` matches the IAM resource `pattern`, where `*` stands for any run of characters. */
function matchesPattern(pattern: string, arn: string): boolean {
  const body = pattern
    .split('*')
    .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}$`).test(arn);
}

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

  it('scopes rule and function deletion by the root-stack tag and role inspection and deletion by the role name pattern', () => {
    const stack       = newTestStack('DetectorGrantsStack');
    const { removal } = newDetectorRemoval(stack);

    const statements = resolveStatements(stack, removal.grantStatements());

    const rolePattern = {
      'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':iam::', { Ref: 'AWS::AccountId' }, ':role/mailbox-diag-role-*-', resolveValue(stack, StackIdentity.guidPrefix)]],
    };
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
      { Action: 'iam:ListRoleTags', Effect: 'Allow', Resource: rolePattern },
      { Action: ['iam:DeleteRolePolicy', 'iam:DeleteRole'], Effect: 'Allow', Resource: rolePattern },
    ]);
  });

  it.each([
    ['the current role of this install', 'arn:aws:iam::123456789012:role/mailbox-diag-role-abcdef12-a1b2c3d4', true],
    ['a renamed role of this install', 'arn:aws:iam::123456789012:role/mailbox-diag-role-ffff0000-a1b2c3d4', true],
    ['a role of another install', 'arn:aws:iam::123456789012:role/mailbox-diag-role-ffff0000-e5f6a7b8', false],
    ['a function of this install', 'arn:aws:iam::123456789012:role/mailbox-diag-fn-ffff0000-a1b2c3d4', false],
    ['a role with another prefix', 'arn:aws:iam::123456789012:role/other-role-ffff0000-a1b2c3d4', false],
  ])('the role grant pattern decides for %s', (_label, arn, admitted) => {
    const stack       = newTestStack('DetectorRolePatternStack');
    const { removal } = newDetectorRemoval(stack);

    const roleStatements = resolveStatements(stack, removal.grantStatements())
      .filter((statement) => JSON.stringify(statement).includes('"iam:'));

    expect(roleStatements).toHaveLength(2);
    for (const statement of roleStatements) {
      const pattern = evaluateString((statement as { Resource: unknown }).Resource);
      expect(matchesPattern(pattern, arn)).toBe(admitted);
    }
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
