/**
 * Coverage for `StackFailureDetectorSweeper`. The detector's rule, function and role are swept as
 * one removal, sequentially (rule -> function -> role) in a single invocation, and the first step
 * that is not done ends the sweep: continuing past a failed or retried step would delete the role
 * while the function that runs under it still exists. Every branch assumes the grace period has
 * already elapsed.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  EventBridgeClient,
  ListTagsForResourceCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda';
import {
  IAMClient,
  ListRoleTagsCommand,
  DeleteRolePolicyCommand,
  DeleteRoleCommand,
} from '@aws-sdk/client-iam';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { StackFailureDetectorRemovalInput } from '../../removal';
import { StackOwnership } from '../../stack-ownership';
import { StackFailureDetectorSweeper } from '../stack-failure-detector-sweeper';

const eventsMock = mockClient(EventBridgeClient);
const lambdaMock = mockClient(LambdaClient);
const iamMock = mockClient(IAMClient);

const ROOT_STACK_NAME = 'test-stack';
const OWNER_TAG_KEY = 'serverless-inbox:root-stack';

const INPUT: StackFailureDetectorRemovalInput = {
  ruleArn: 'arn:aws:events:us-west-2:123456789012:rule/mailbox-diag-rule-abc123',
  ruleTargetId: 'Target0',
  detectorFnArn: 'arn:aws:lambda:us-west-2:123456789012:function:mailbox-diag-fn-abc123',
  detectorRoleArn: 'arn:aws:iam::123456789012:role/mailbox-diag-role-abc123',
  detectorRolePolicyName: 'stack-failure-detector-policy',
  rootStackName: ROOT_STACK_NAME,
};

function sweep(input: StackFailureDetectorRemovalInput = INPUT) {
  const region = { region: 'us-west-2' };
  const logger = new LoggerBuffer();
  const sweeper = new StackFailureDetectorSweeper(
    new EventBridgeClient(region),
    new LambdaClient(region),
    new IAMClient(region),
    new StackOwnership(logger),
    logger,
  );
  return sweeper.sweep(input);
}

function mockAllStepsSucceeding(): void {
  eventsMock.on(ListTagsForResourceCommand).resolves({ Tags: [{ Key: OWNER_TAG_KEY, Value: ROOT_STACK_NAME }] });
  eventsMock.on(RemoveTargetsCommand).resolves({});
  eventsMock.on(DeleteRuleCommand).resolves({});
  lambdaMock.on(GetFunctionCommand).resolves({ Tags: { [OWNER_TAG_KEY]: ROOT_STACK_NAME } });
  lambdaMock.on(DeleteFunctionCommand).resolves({});
  iamMock.on(ListRoleTagsCommand).resolves({ Tags: [{ Key: OWNER_TAG_KEY, Value: ROOT_STACK_NAME }] });
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

    expect(result).toEqual({ target: 'detector', status: 'done' });
    expect(eventsMock.commandCalls(RemoveTargetsCommand)[0].args[0].input).toEqual({
      Rule: 'mailbox-diag-rule-abc123',
      Ids: ['Target0'],
    });
    expect(eventsMock.commandCalls(DeleteRuleCommand)[0].args[0].input).toEqual({ Name: 'mailbox-diag-rule-abc123' });
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)[0].args[0].input).toEqual({
      FunctionName: 'mailbox-diag-fn-abc123',
    });
    expect(iamMock.commandCalls(DeleteRolePolicyCommand)[0].args[0].input).toEqual({
      RoleName: 'mailbox-diag-role-abc123',
      PolicyName: 'stack-failure-detector-policy',
    });
    expect(iamMock.commandCalls(DeleteRoleCommand)[0].args[0].input).toEqual({ RoleName: 'mailbox-diag-role-abc123' });
  });

  it('passes IAM the bare role name when the role ARN carries a path', async () => {
    mockAllStepsSucceeding();

    await sweep({ ...INPUT, detectorRoleArn: 'arn:aws:iam::123456789012:role/team/diag/mailbox-diag-role-abc123' });

    expect(iamMock.commandCalls(ListRoleTagsCommand)[0].args[0].input).toEqual({ RoleName: 'mailbox-diag-role-abc123' });
    expect(iamMock.commandCalls(DeleteRoleCommand)[0].args[0].input).toEqual({ RoleName: 'mailbox-diag-role-abc123' });
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

    expect(await sweep()).toEqual({ target: 'detector', status: 'done' });
  });

  it('fails immediately on rule ownership mismatch without touching the function or role', async () => {
    eventsMock.on(ListTagsForResourceCommand).resolves({ Tags: [{ Key: OWNER_TAG_KEY, Value: 'someone-elses-stack' }] });

    const result = await sweep();

    expect(result).toEqual({
      target: 'detector',
      status: 'failed',
      reason: 'Ownership mismatch (expected test-stack, got someone-elses-stack)',
    });
    expect(eventsMock.commandCalls(DeleteRuleCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(GetFunctionCommand)).toHaveLength(0);
    expect(iamMock.commandCalls(ListRoleTagsCommand)).toHaveLength(0);
  });

  it('stops at the function step on a function ownership mismatch, without attempting the role', async () => {
    mockAllStepsSucceeding();
    lambdaMock.on(GetFunctionCommand).resolves({ Tags: { [OWNER_TAG_KEY]: 'someone-elses-stack' } });

    const result = await sweep();

    expect(result.status).toBe('failed');
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)).toHaveLength(0);
    expect(iamMock.commandCalls(ListRoleTagsCommand)).toHaveLength(0);
  });

  it('stops at the role step on a role ownership mismatch, without deleting the role', async () => {
    mockAllStepsSucceeding();
    iamMock.on(ListRoleTagsCommand).resolves({ Tags: [{ Key: OWNER_TAG_KEY, Value: 'someone-elses-stack' }] });

    const result = await sweep();

    expect(result.status).toBe('failed');
    expect(iamMock.commandCalls(DeleteRolePolicyCommand)).toHaveLength(0);
    expect(iamMock.commandCalls(DeleteRoleCommand)).toHaveLength(0);
  });

  it('reports failed, naming the error, when a step hits an unexpected error', async () => {
    mockAllStepsSucceeding();
    lambdaMock.on(DeleteFunctionCommand).rejects(
      Object.assign(new Error('denied'), { name: 'AccessDeniedException' }),
    );

    expect(await sweep()).toEqual({ target: 'detector', status: 'failed', reason: 'AccessDeniedException: denied' });
  });

  it('still deletes the role when its inline policy is already gone (NoSuchEntityException)', async () => {
    mockAllStepsSucceeding();
    iamMock.on(DeleteRolePolicyCommand).rejects(
      Object.assign(new Error('no such policy'), { name: 'NoSuchEntityException' }),
    );

    expect(await sweep()).toEqual({ target: 'detector', status: 'done' });
    expect(iamMock.commandCalls(DeleteRoleCommand)).toHaveLength(1);
  });

  it('retries when only the role still has attached policies (DeleteConflictException)', async () => {
    mockAllStepsSucceeding();
    iamMock.on(DeleteRoleCommand).rejects(
      Object.assign(new Error('conflict'), { name: 'DeleteConflictException' }),
    );

    expect(await sweep()).toEqual({ target: 'detector', status: 'retry', reason: 'DeleteConflictException' });
  });
});
