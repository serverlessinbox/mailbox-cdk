/**
 * Coverage for `EdgeFunctionSweeper`: the root stack check via GetFunction tags gates the delete,
 * ResourceNotFoundException -> already done, root stack mismatch -> failed, any other error (e.g.
 * CloudFront replicas still draining) -> retry. Treating a draining error as failed would abort a
 * sweep that succeeds on the next attempt; treating a mismatch as retry would loop on a function
 * that is never ours to delete.
 */

import { mockClient } from 'aws-sdk-client-mock';
import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { EdgeFunctionRemovalInput } from '../../removal';
import { RootStackMembership } from '../../root-stack-membership';
import { EdgeFunctionSweeper } from '../edge-function-sweeper';

const lambdaMock = mockClient(LambdaClient);
const ROOT_STACK_NAME = 'test-stack';
const EDGE_FN_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:jmap-blob-download';

const INPUT: EdgeFunctionRemovalInput = { edgeFnArn: EDGE_FN_ARN, rootStackName: ROOT_STACK_NAME, rootStackId: 'guid-1' };

function sweep() {
  const logger = new LoggerBuffer();
  return new EdgeFunctionSweeper(new LambdaClient({ region: 'us-east-1' }), new RootStackMembership(logger), logger).sweep(INPUT);
}

beforeEach(() => {
  lambdaMock.reset();
});

describe('EdgeFunctionSweeper', () => {
  it('deletes the function by name and reports done when it belongs to the root stack', async () => {
    lambdaMock.on(GetFunctionCommand).resolves({ Tags: { 'serverless-inbox:root-stack': ROOT_STACK_NAME } });
    lambdaMock.on(DeleteFunctionCommand).resolves({});

    const result = await sweep();

    expect(result).toEqual({ target: 'edge-fn', status: 'done' });
    expect(lambdaMock.commandCalls(GetFunctionCommand)[0].args[0].input).toEqual({ FunctionName: 'jmap-blob-download' });
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)[0].args[0].input).toEqual({ FunctionName: 'jmap-blob-download' });
  });

  it('treats a missing function as already deleted', async () => {
    lambdaMock.on(GetFunctionCommand).rejects(
      Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }),
    );

    expect(await sweep()).toEqual({ target: 'edge-fn', status: 'done' });
  });

  it('fails on root stack mismatch without attempting delete', async () => {
    lambdaMock.on(GetFunctionCommand).resolves({ Tags: { 'serverless-inbox:root-stack': 'someone-elses-stack' } });

    const result = await sweep();

    expect(result).toEqual({
      target: 'edge-fn',
      status: 'failed',
      reason: 'Root stack mismatch (expected test-stack / guid-1, got someone-elses-stack / undefined)',
    });
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)).toHaveLength(0);
  });

  it('retries, naming the error, on a transient error (e.g. CloudFront replicas still draining)', async () => {
    lambdaMock.on(GetFunctionCommand).resolves({ Tags: { 'serverless-inbox:root-stack': ROOT_STACK_NAME } });
    lambdaMock.on(DeleteFunctionCommand).rejects(
      Object.assign(new Error('still replicated'), { name: 'InvalidParameterValueException' }),
    );

    expect(await sweep()).toEqual({
      target: 'edge-fn',
      status: 'retry',
      reason: 'InvalidParameterValueException: still replicated',
    });
  });
});
