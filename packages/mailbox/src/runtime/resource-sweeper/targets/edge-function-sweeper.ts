import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand }    from '@aws-sdk/client-lambda';
import { CaughtError, parseArn, type LoggerBuffer }                   from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { EdgeFunctionRemovalInput, TargetResult, TargetSweeper } from '../removal';
import { RootStackMembership }                                        from '../root-stack-membership';
import { TargetResults }                                              from '../target-results';

/**
 * Sweeps the Lambda@Edge function named by `EdgeFunctionRemovalInput.edgeFnArn`: deletes it once it
 * belongs to the root stack. The Lambda client must be the us-east-1 one, the only region Lambda@Edge
 * functions live in.
 */
export class EdgeFunctionSweeper implements TargetSweeper<EdgeFunctionRemovalInput> {
  private readonly results = new TargetResults('edge-fn');

  constructor(
    private readonly lambdaClient: LambdaClient,
    private readonly rootStackMembership: RootStackMembership,
    private readonly logger: LoggerBuffer,
  ) {}

  /**
   * Deletes the function when it belongs to the root stack. Resolves to `done` once the function is gone
   * (deleted now, or already absent), `failed` on a root stack mismatch, and `retry` on any other
   * error. Never rejects.
   */
  public async sweep(input: EdgeFunctionRemovalInput): Promise<TargetResult> {
    try {
      return await this.deleteWhenInRootStack(input);
    } catch (thrown) {
      return this.resultOfFailure(thrown);
    }
  }

  private async deleteWhenInRootStack(input: EdgeFunctionRemovalInput): Promise<TargetResult> {
    const functionName = parseArn(input.edgeFnArn).resourceName;

    const mismatch = await this.findRootStackMismatch(input, functionName);
    // Never delete what belongs to another stack. A mismatch is final, so it is not retried.
    if (mismatch) {
      return this.results.failed(mismatch);
    }

    await this.deleteFunction(functionName);
    return this.results.done();
  }

  private async findRootStackMismatch(input: EdgeFunctionRemovalInput, functionName: string): Promise<string | undefined> {
    this.logger.debug('Verifying Lambda function belongs to the root stack');
    const getResp = await this.lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
    return this.rootStackMembership.mismatchInTagMap(input, 'Lambda function', getResp.Tags);
  }

  private async deleteFunction(functionName: string): Promise<void> {
    this.logger.info('Lambda function belongs to the root stack; attempting delete');
    await this.lambdaClient.send(new DeleteFunctionCommand({ FunctionName: functionName }));
    this.logger.info('Lambda function deleted successfully');
  }

  private resultOfFailure(thrown: unknown): TargetResult {
    const error = new CaughtError(thrown);
    // A function that no longer exists is what the sweep is after, so it counts as swept.
    if (error.is('ResourceNotFoundException')) {
      this.logger.debug('Lambda function not found; treating as deleted');
      return this.results.done();
    }

    // Any other error is retried, because it may be transient, e.g. CloudFront replicas of the function still draining.
    this.logger.warn('Lambda function deletion error (will retry)', {
      errorName:    error.name,
      errorMessage: error.message,
    });
    return this.results.retry(error.describe());
  }
}
