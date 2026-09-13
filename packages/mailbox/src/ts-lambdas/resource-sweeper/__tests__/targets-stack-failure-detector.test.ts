/**
 * Coverage for `sweepStackFailureDetector` against its own `StackFailureDetectorRemovalInput` type.
 * The stack-failure detector's rule, function and role are swept together as ONE removal (see
 * `features/sweeper/stack-failure-detector-removal.ts` for why they're grouped) — this sub-handler
 * runs the three steps sequentially (rule -> function -> role) in a single invocation. The
 * grace-period wait that used to be a `graceUntil` flag checked here is now a Wait step the CDK
 * removal contributes to the state machine (see `StackFailureDetectorRemoval.buildChain`), so this
 * sub-handler has no grace logic of its own — every branch below assumes the grace period has
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
import { sweepStackFailureDetector } from '../targets/stack-failure-detector';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { StackFailureDetectorRemovalInput } from '../targets/types';

const eventsMock = mockClient(EventBridgeClient);
const lambdaMock = mockClient(LambdaClient);
const iamMock = mockClient(IAMClient);

const ROOT_STACK_NAME = 'test-stack';
const RULE_ARN = 'arn:aws:events:us-west-2:123456789012:rule/mailbox-diag-rule-abc123';
const DETECTOR_FN_ARN = 'arn:aws:lambda:us-west-2:123456789012:function:mailbox-diag-fn-abc123';
const DETECTOR_ROLE_ARN = 'arn:aws:iam::123456789012:role/mailbox-diag-role-abc123';

function input(overrides: Partial<StackFailureDetectorRemovalInput> = {}): StackFailureDetectorRemovalInput {
  return {
    ruleArn: RULE_ARN,
    ruleTargetId: 'Target0',
    detectorFnArn: DETECTOR_FN_ARN,
    detectorRoleArn: DETECTOR_ROLE_ARN,
    detectorRolePolicyName: 'stack-failure-detector-policy',
    rootStackName: ROOT_STACK_NAME,
    ...overrides,
  };
}

function logger(): LoggerBuffer {
  return new LoggerBuffer(undefined);
}

function eventsClient(): EventBridgeClient {
  return new EventBridgeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
}

function lambdaClientFn(): LambdaClient {
  return new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
}

function iamClientFn(): IAMClient {
  return new IAMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
}

function mockAllSteps(): void {
  eventsMock.on(ListTagsForResourceCommand).resolves({
    Tags: [{ Key: 'serverless-inbox:root-stack', Value: ROOT_STACK_NAME }],
  });
  eventsMock.on(RemoveTargetsCommand).resolves({});
  eventsMock.on(DeleteRuleCommand).resolves({});
  lambdaMock.on(GetFunctionCommand).resolves({ Tags: { 'serverless-inbox:root-stack': ROOT_STACK_NAME } });
  lambdaMock.on(DeleteFunctionCommand).resolves({});
  iamMock.on(ListRoleTagsCommand).resolves({
    Tags: [{ Key: 'serverless-inbox:root-stack', Value: ROOT_STACK_NAME }],
  });
  iamMock.on(DeleteRolePolicyCommand).resolves({});
  iamMock.on(DeleteRoleCommand).resolves({});
}

beforeEach(() => {
  eventsMock.reset();
  lambdaMock.reset();
  iamMock.reset();
});

describe('sweepStackFailureDetector', () => {
  it('removes the rule targets, deletes the rule, function and role in sequence, and reports done', async () => {
    mockAllSteps();

    const result = await sweepStackFailureDetector(input(), logger(), eventsClient(), lambdaClientFn(), iamClientFn());

    expect(result).toEqual({ target: 'detector', status: 'done' });
    expect(eventsMock.commandCalls(RemoveTargetsCommand)[0].args[0].input).toEqual({
      Rule: 'mailbox-diag-rule-abc123',
      Ids: ['Target0'],
    });
    expect(eventsMock.commandCalls(DeleteRuleCommand)[0].args[0].input).toEqual({
      Name: 'mailbox-diag-rule-abc123',
    });
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)[0].args[0].input).toEqual({
      FunctionName: 'mailbox-diag-fn-abc123',
    });
    expect(iamMock.commandCalls(DeleteRolePolicyCommand)[0].args[0].input).toEqual({
      RoleName: 'mailbox-diag-role-abc123',
      PolicyName: 'stack-failure-detector-policy',
    });
    expect(iamMock.commandCalls(DeleteRoleCommand)[0].args[0].input).toEqual({
      RoleName: 'mailbox-diag-role-abc123',
    });
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

    const result = await sweepStackFailureDetector(input(), logger(), eventsClient(), lambdaClientFn(), iamClientFn());

    expect(result).toEqual({ target: 'detector', status: 'done' });
  });

  it('fails immediately on rule ownership mismatch without touching the function or role', async () => {
    eventsMock.on(ListTagsForResourceCommand).resolves({
      Tags: [{ Key: 'serverless-inbox:root-stack', Value: 'someone-elses-stack' }],
    });

    const result = await sweepStackFailureDetector(input(), logger(), eventsClient(), lambdaClientFn(), iamClientFn());

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('Ownership mismatch');
    expect(lambdaMock.commandCalls(GetFunctionCommand)).toHaveLength(0);
    expect(iamMock.commandCalls(ListRoleTagsCommand)).toHaveLength(0);
  });

  it('stops at the function step on a hard error, without attempting the role', async () => {
    eventsMock.on(ListTagsForResourceCommand).resolves({
      Tags: [{ Key: 'serverless-inbox:root-stack', Value: ROOT_STACK_NAME }],
    });
    eventsMock.on(RemoveTargetsCommand).resolves({});
    eventsMock.on(DeleteRuleCommand).resolves({});
    lambdaMock.on(GetFunctionCommand).resolves({ Tags: { 'serverless-inbox:root-stack': 'someone-elses-stack' } });

    const result = await sweepStackFailureDetector(input(), logger(), eventsClient(), lambdaClientFn(), iamClientFn());

    expect(result.status).toBe('failed');
    expect(iamMock.commandCalls(ListRoleTagsCommand)).toHaveLength(0);
  });

  it('retries when only the role still has attached policies (DeleteConflictException)', async () => {
    mockAllSteps();
    iamMock.on(DeleteRoleCommand).rejects(
      Object.assign(new Error('conflict'), { name: 'DeleteConflictException' }),
    );

    const result = await sweepStackFailureDetector(input(), logger(), eventsClient(), lambdaClientFn(), iamClientFn());

    expect(result).toEqual({ target: 'detector', status: 'retry', reason: 'DeleteConflictException' });
  });
});
