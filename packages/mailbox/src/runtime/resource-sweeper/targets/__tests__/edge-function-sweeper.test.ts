/**
 * Coverage for `EdgeFunctionSweeper`: the root stack check via GetFunction tags gates the delete,
 * ResourceNotFoundException -> already done, root stack mismatch -> failed, a delete refused because
 * CloudFront replicas still hold the function -> retry, any other error -> failed. Treating a
 * permanent error as retry would spin until the workflow times out; treating a replica refusal as
 * failed would abort a sweep that succeeds on the next attempt.
 */

import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda';
import { LoggerBuffer }                                            from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                              from 'aws-sdk-client-mock';

import type { EdgeFunctionRemovalInput }                           from '../../removal';
import { RootStackMembership }                                     from '../../root-stack-membership';
import { EdgeFunctionSweeper }                                     from '../edge-function-sweeper';

const lambdaMock      = mockClient(LambdaClient);
const ROOT_STACK_NAME = 'test-stack';
const EDGE_FN_ARN     = 'arn:aws:lambda:us-east-1:123456789012:function:jmap-blob-download';

const INPUT: EdgeFunctionRemovalInput = { edgeFnArn: EDGE_FN_ARN, rootStackName: ROOT_STACK_NAME, rootStackId: 'guid-1' };

function sweep() {
  const logger  = new LoggerBuffer();
  const sweeper = new EdgeFunctionSweeper(new LambdaClient({ region: 'us-east-1' }), new RootStackMembership(logger), logger);
  return sweeper.sweep(INPUT);
}

beforeEach(() => {
  lambdaMock.reset();
});

describe('EdgeFunctionSweeper', () => {
  it('deletes the function by name and reports done when it belongs to the root stack', async () => {
    lambdaMock.on(GetFunctionCommand).resolves({ Tags: { 'serverless-inbox:root-stack': ROOT_STACK_NAME } });
    lambdaMock.on(DeleteFunctionCommand).resolves({});

    const result = await sweep();

    expect(result).toEqual({ target: 'edge-fn', status: 'SUCCESS' });
    expect(lambdaMock.commandCalls(GetFunctionCommand)[0].args[0].input).toEqual({ FunctionName: 'jmap-blob-download' });
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)[0].args[0].input).toEqual({ FunctionName: 'jmap-blob-download' });
  });

  it('treats a missing function as already deleted', async () => {
    lambdaMock.on(GetFunctionCommand).rejects(
      Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }),
    );

    expect(await sweep()).toEqual({ target: 'edge-fn', status: 'SUCCESS' });
  });

  it('fails on root stack mismatch without attempting delete', async () => {
    lambdaMock.on(GetFunctionCommand).resolves({ Tags: { 'serverless-inbox:root-stack': 'someone-elses-stack' } });

    const result = await sweep();

    expect(result).toEqual({
      target: 'edge-fn',
      status: 'FAILED',
      reason: 'Root stack mismatch (expected test-stack / guid-1, got someone-elses-stack / undefined)',
    });
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)).toHaveLength(0);
  });

  it('retries, naming the error, while CloudFront replicas still hold the function', async () => {
    lambdaMock.on(GetFunctionCommand).resolves({ Tags: { 'serverless-inbox:root-stack': ROOT_STACK_NAME } });
    lambdaMock.on(DeleteFunctionCommand).rejects(
      Object.assign(new Error('still replicated'), { name: 'InvalidParameterValueException' }),
    );

    expect(await sweep()).toEqual({
      target: 'edge-fn',
      status: 'RETRY',
      reason: 'InvalidParameterValueException: still replicated',
    });
  });

  it('fails, naming the error, on a delete refused for any other reason', async () => {
    lambdaMock.on(GetFunctionCommand).resolves({ Tags: { 'serverless-inbox:root-stack': ROOT_STACK_NAME } });
    lambdaMock.on(DeleteFunctionCommand).rejects(
      Object.assign(new Error('not allowed'), { name: 'AccessDeniedException' }),
    );

    expect(await sweep()).toEqual({
      target: 'edge-fn',
      status: 'FAILED',
      reason: 'AccessDeniedException: not allowed',
    });
  });

  it('fails on an invalid-parameter delete error that does not concern replicas', async () => {
    lambdaMock.on(GetFunctionCommand).resolves({ Tags: { 'serverless-inbox:root-stack': ROOT_STACK_NAME } });
    lambdaMock.on(DeleteFunctionCommand).rejects(
      Object.assign(new Error('bad runtime'), { name: 'InvalidParameterValueException' }),
    );

    expect(await sweep()).toEqual({
      target: 'edge-fn',
      status: 'FAILED',
      reason: 'InvalidParameterValueException: bad runtime',
    });
  });

  it('fails, naming the error, when the root stack tag read is refused', async () => {
    lambdaMock.on(GetFunctionCommand).rejects(
      Object.assign(new Error('not allowed'), { name: 'AccessDeniedException' }),
    );

    expect(await sweep()).toEqual({
      target: 'edge-fn',
      status: 'FAILED',
      reason: 'AccessDeniedException: not allowed',
    });
    expect(lambdaMock.commandCalls(DeleteFunctionCommand)).toHaveLength(0);
  });
});
