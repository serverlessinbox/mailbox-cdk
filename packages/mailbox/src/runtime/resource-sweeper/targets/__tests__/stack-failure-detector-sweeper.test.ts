/**
 * Coverage for `StackFailureDetectorSweeper`. The parts of the detector the input carries (rule,
 * function, role) are swept sequentially (rule -> function -> role) in a single invocation, a part the
 * input does not carry is never touched, and the first step
 * that is not done ends the sweep: continuing past a failed or retried step would delete the role
 * while the function that runs under it still exists. Every branch assumes the grace period has
 * already elapsed.
 */

import {
  EventBridgeClient,
  ListTagsForResourceCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import {
  IAMClient,
  ListRoleTagsCommand,
  DeleteRolePolicyCommand,
  DeleteRoleCommand,
} from '@aws-sdk/client-iam';
import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda';
import { LoggerBuffer }                                            from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                              from 'aws-sdk-client-mock';

import type { StackFailureDetectorRemovalInput }                   from '../../removal';
import { RootStackMembership }                                     from '../../root-stack-membership';
import { StackFailureDetectorSweeper }                             from '../stack-failure-detector-sweeper';

const eventsMock = mockClient(EventBridgeClient);
const lambdaMock = mockClient(LambdaClient);
const iamMock    = mockClient(IAMClient);

const ROOT_STACK_NAME    = 'test-stack';
const ROOT_STACK_TAG_KEY = 'serverless-inbox:root-stack';

const INPUT: StackFailureDetectorRemovalInput = {
  ruleArn:                'arn:aws:events:us-west-2:123456789012:rule/mailbox-diag-rule-abc123',
  ruleTargetId:           'Target0',
  detectorFnArn:          'arn:aws:lambda:us-west-2:123456789012:function:mailbox-diag-fn-abc123',
  detectorRoleArn:        'arn:aws:iam::123456789012:role/mailbox-diag-role-abc123',
  detectorRolePolicyName: 'stack-failure-detector-policy',
  rootStackName:          ROOT_STACK_NAME,
  rootStackId:            'guid-1',
};

function sweep(input: StackFailureDetectorRemovalInput = INPUT) {
  const region  = { region: 'us-west-2' };
  const logger  = new LoggerBuffer();
  const sweeper = new StackFailureDetectorSweeper(
    new EventBridgeClient(region),
    new LambdaClient(region),
    new IAMClient(region),
    new RootStackMembership(logger),
    logger,
  );
  return sweeper.sweep(input);
}

function mockAllStepsSucceeding(): void {
  eventsMock.on(ListTagsForResourceCommand).resolves({ Tags: [{ Key: ROOT_STACK_TAG_KEY, Value: ROOT_STACK_NAME }] });
  eventsMock.on(RemoveTargetsCommand).resolves({});
  eventsMock.on(DeleteRuleCommand).resolves({});
  lambdaMock.on(GetFunctionCommand).resolves({ Tags: { [ROOT_STACK_TAG_KEY]: ROOT_STACK_NAME } });
  lambdaMock.on(DeleteFunctionCommand).resolves({});
  iamMock.on(ListRoleTagsCommand).resolves({ Tags: [{ Key: ROOT_STACK_TAG_KEY, Value: ROOT_STACK_NAME }] });
  iamMock.on(DeleteRolePolicyCommand).resolves({});
  iamMock.on(DeleteRoleCommand).resolves({});
}

beforeEach(() => {
  eventsMock.reset();
  lambdaMock.reset();
  iamMock.reset();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('StackFailureDetectorSweeper', () => {
  it('removes the rule targets, deletes the rule, function and role, and reports done', async () => {
    mockAllStepsSucceeding();

    const result = await sweep();

    expect(result).toEqual({ target: 'detector', status: 'SUCCESS' });
    expect(eventsMock.commandCalls(RemoveTargetsCommand)[0].args[0].input).toEqual({
      Rule: 'mailbox-diag-rule-abc123',
      Ids:  ['Target0'],
    });
    expect(eventsMock.commandCalls(DeleteRuleCommand)[0].args[0].input).toEqual({ Name: 'mailbox-diag-rule-abc123' });
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)[0].args[0].input).toEqual({
      FunctionName: 'mailbox-diag-fn-abc123',
    });
    expect(iamMock.commandCalls(DeleteRolePolicyCommand)[0].args[0].input).toEqual({
      RoleName:   'mailbox-diag-role-abc123',
      PolicyName: 'stack-failure-detector-policy',
    });
    expect(iamMock.commandCalls(DeleteRoleCommand)[0].args[0].input).toEqual({ RoleName: 'mailbox-diag-role-abc123' });
  });

  it('touches only the rule when the input carries only the rule part, leaving the live function and role alone', async () => {
    mockAllStepsSucceeding();

    const result = await sweep({
      ruleArn:       INPUT.ruleArn,
      ruleTargetId:  INPUT.ruleTargetId,
      rootStackName: INPUT.rootStackName,
      rootStackId:   INPUT.rootStackId,
    });

    expect(result).toEqual({ target: 'detector', status: 'SUCCESS' });
    expect(eventsMock.commandCalls(DeleteRuleCommand)).toHaveLength(1);
    expect(lambdaMock.calls()).toHaveLength(0);
    expect(iamMock.calls()).toHaveLength(0);
  });

  it('touches only the function and role when the input carries those parts, leaving the rule alone', async () => {
    mockAllStepsSucceeding();

    const result = await sweep({
      detectorFnArn:          INPUT.detectorFnArn,
      detectorRoleArn:        INPUT.detectorRoleArn,
      detectorRolePolicyName: INPUT.detectorRolePolicyName,
      rootStackName:          INPUT.rootStackName,
      rootStackId:            INPUT.rootStackId,
    });

    expect(result).toEqual({ target: 'detector', status: 'SUCCESS' });
    expect(eventsMock.calls()).toHaveLength(0);
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)).toHaveLength(1);
    expect(iamMock.commandCalls(DeleteRoleCommand)).toHaveLength(1);
  });

  it('treats every already-deleted resource (Not Found style errors) as already done', async () => {
    eventsMock.on(ListTagsForResourceCommand).rejects(
      Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }),
    );
    lambdaMock.on(GetFunctionCommand).rejects(
      Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }),
    );
    iamMock.on(ListRoleTagsCommand).rejects(
      Object.assign(new Error('no such entity'), { name: 'NoSuchEntityException' }),
    );

    expect(await sweep()).toEqual({ target: 'detector', status: 'SUCCESS' });
  });

  it('fails immediately on rule root stack mismatch without touching the function or role', async () => {
    eventsMock.on(ListTagsForResourceCommand).resolves({ Tags: [{ Key: ROOT_STACK_TAG_KEY, Value: 'someone-elses-stack' }] });

    const result = await sweep();

    expect(result).toEqual({
      target: 'detector',
      status: 'FAILED',
      reason: 'Root stack mismatch (expected test-stack / guid-1, got someone-elses-stack / undefined)',
    });
    expect(eventsMock.commandCalls(DeleteRuleCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(GetFunctionCommand)).toHaveLength(0);
    expect(iamMock.commandCalls(ListRoleTagsCommand)).toHaveLength(0);
  });

  it('stops at the function step on a function root stack mismatch, without attempting the role', async () => {
    mockAllStepsSucceeding();
    lambdaMock.on(GetFunctionCommand).resolves({ Tags: { [ROOT_STACK_TAG_KEY]: 'someone-elses-stack' } });

    const result = await sweep();

    expect(result.status).toBe('FAILED');
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)).toHaveLength(0);
    expect(iamMock.commandCalls(ListRoleTagsCommand)).toHaveLength(0);
  });

  it('reports failed, naming the error, when a step hits an unexpected error', async () => {
    mockAllStepsSucceeding();
    lambdaMock.on(DeleteFunctionCommand).rejects(
      Object.assign(new Error('denied'), { name: 'AccessDeniedException' }),
    );

    expect(await sweep()).toEqual({ target: 'detector', status: 'FAILED', reason: 'AccessDeniedException: denied' });
  });
});
