import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand } from '@aws-sdk/client-lambda';
import { CaughtError, parseArn, type LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { EdgeFunctionRemovalInput, TargetResult, TargetSweeper } from '../removal';
import { StackOwnership } from '../stack-ownership';
import { TargetResults } from '../target-results';

/**
 * Sweeps the Lambda@Edge function named by `EdgeFunctionRemovalInput.edgeFnArn`: deletes it once the
 * root stack owns it. The Lambda client must be the us-east-1 one, the only region Lambda@Edge
 * functions live in.
 */
export class EdgeFunctionSweeper implements TargetSweeper<EdgeFunctionRemovalInput> {
  private readonly results = new TargetResults('edge-fn');

  constructor(
    private readonly lambdaClient: LambdaClient,
    private readonly ownership: StackOwnership,
    private readonly logger: LoggerBuffer,
  ) {}

  /**
   * Deletes the function when the root stack owns it. Resolves to `done` once the function is gone
   * (deleted now, or already absent), `failed` on an ownership mismatch, and `retry` on any other
   * error. Never rejects.
   */
  public async sweep(input: EdgeFunctionRemovalInput): Promise<TargetResult> {
    try {
      return await this.deleteWhenOwned(input);
    } catch (thrown) {
      return this.resultOfFailure(thrown);
    }
  }

  private async deleteWhenOwned(input: EdgeFunctionRemovalInput): Promise<TargetResult> {
    const functionName = parseArn(input.edgeFnArn).resourceName;

    const mismatch = await this.findOwnershipMismatch(input, functionName);
    // Never delete what another stack owns. A mismatch is final, so it is not retried.
    if (mismatch) {
      return this.results.failed(mismatch);
    }

    await this.deleteFunction(functionName);
    return this.results.done();
  }

  private async findOwnershipMismatch(input: EdgeFunctionRemovalInput, functionName: string): Promise<string | undefined> {
    this.logger.debug('Verifying Lambda function ownership');
    const getResp = await this.lambdaClient.send(new GetFunctionCommand({ FunctionName: functionName }));
    return this.ownership.mismatchInTagMap(input.rootStackName, 'Lambda function', getResp.Tags);
  }

  private async deleteFunction(functionName: string): Promise<void> {
    this.logger.info('Lambda function ownership verified; attempting delete');
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
      errorName: error.name,
      errorMessage: error.message,
    });
    return this.results.retry(error.describe());
  }
}
