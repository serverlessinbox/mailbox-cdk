/**
 * Coverage for the edge-function removal sub-handler against its own `EdgeFunctionRemovalInput`
 * type — behaviour is unchanged from before the per-removal-type rework (see `targets/edge-fn.ts`):
 * always us-east-1, ownership check via GetFunction tags, ResourceNotFoundException -> already done,
 * ownership mismatch -> failed, any other error (e.g. replicas draining) -> retry.
 */

import { mockClient } from 'aws-sdk-client-mock';
import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda';
import { sweepEdgeFn } from '../targets/edge-fn';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { EdgeFunctionRemovalInput } from '../targets/types';

const lambdaMock = mockClient(LambdaClient);
const ROOT_STACK_NAME = 'test-stack';
const EDGE_FN_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:blob-authorizer';

function input(overrides: Partial<EdgeFunctionRemovalInput> = {}): EdgeFunctionRemovalInput {
  return { edgeFnArn: EDGE_FN_ARN, rootStackName: ROOT_STACK_NAME, ...overrides };
}

function logger(): LoggerBuffer {
  return new LoggerBuffer(undefined);
}

function lambdaClient(): LambdaClient {
  return new LambdaClient({ region: 'us-east-1' });
}

beforeEach(() => {
  lambdaMock.reset();
});

describe('sweepEdgeFn', () => {
  it('deletes the function and reports done on ownership match', async () => {
    lambdaMock.on(GetFunctionCommand).resolves({
      Tags: { 'serverless-inbox:root-stack': ROOT_STACK_NAME },
    });
    lambdaMock.on(DeleteFunctionCommand).resolves({});

    const result = await sweepEdgeFn(input(), logger(), lambdaClient());

    expect(result).toEqual({ target: 'edge-fn', status: 'done' });
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)[0].args[0].input).toEqual({
      FunctionName: 'blob-authorizer',
    });
  });

  it('treats a missing function as already deleted', async () => {
    lambdaMock.on(GetFunctionCommand).rejects(
      Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }),
    );

    const result = await sweepEdgeFn(input(), logger(), lambdaClient());

    expect(result).toEqual({ target: 'edge-fn', status: 'done' });
  });

  it('fails on ownership mismatch without attempting delete', async () => {
    lambdaMock.on(GetFunctionCommand).resolves({
      Tags: { 'serverless-inbox:root-stack': 'someone-elses-stack' },
    });

    const result = await sweepEdgeFn(input(), logger(), lambdaClient());

    expect(result.status).toBe('failed');
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)).toHaveLength(0);
  });

  it('retries on a transient error (e.g. CloudFront replicas still draining)', async () => {
    lambdaMock.on(GetFunctionCommand).resolves({
      Tags: { 'serverless-inbox:root-stack': ROOT_STACK_NAME },
    });
    lambdaMock.on(DeleteFunctionCommand).rejects(
      Object.assign(new Error('still replicated'), { name: 'InvalidParameterValueException' }),
    );

    const result = await sweepEdgeFn(input(), logger(), lambdaClient());

    expect(result.status).toBe('retry');
  });
});
