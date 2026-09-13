import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { EdgeFunctionRemovalInput, TargetResult } from './types';

/**
 * Sweeps the Lambda@Edge function named by `input.edgeFnArn`. Always us-east-1, per Lambda@Edge's
 * own constraint. GetFunction → verify tag. DeleteFunction.
 * ResourceNotFoundException → already done. Ownership mismatch → failed.
 * Other error (e.g. CloudFront replicas still draining) → retry.
 */
export async function sweepEdgeFn(input: EdgeFunctionRemovalInput, logger: LoggerBuffer): Promise<TargetResult> {
  const { edgeFnArn } = input;

  try {
    const lambdaClient = new LambdaClient({ region: 'us-east-1' });
    // Format: arn:aws:lambda:us-east-1:ACCOUNT:function:FUNCTION-NAME
    const functionName = edgeFnArn.split(':').pop()!;

    try {
      logger.debug('Verifying Lambda function ownership');
      const getResp = await lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
      const tags = getResp.Tags ?? {};
      const ownerStack = tags['serverless-inbox:root-stack'];
      if (ownerStack !== input.rootStackName) {
        logger.warn('Lambda function ownership mismatch', {
          expectedStack: input.rootStackName,
          actualStack: ownerStack,
        });
        return {
          target: 'edge-fn',
          status: 'failed',
          reason: `Ownership mismatch (expected ${input.rootStackName}, got ${ownerStack})`,
        };
      }

      logger.info('Lambda function ownership verified; attempting delete');
      await lambdaClient.send(new DeleteFunctionCommand({ FunctionName: functionName }));
      logger.info('Lambda function deleted successfully');
      return { target: 'edge-fn', status: 'done' };
    } catch (err: any) {
      if (err.name === 'ResourceNotFoundException') {
        logger.debug('Lambda function not found; treating as deleted');
        return { target: 'edge-fn', status: 'done' };
      }
      throw err;
    }
  } catch (err: any) {
    // Replicas draining or other transient error → retry
    logger.warn('Lambda function deletion error (will retry)', {
      errorName: err?.name,
      errorMessage: err?.message,
    });
    return { target: 'edge-fn', status: 'retry', reason: `${err?.name}: ${err?.message}` };
  }
}
