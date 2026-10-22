import { LambdaClient, GetFunctionCommand, DeleteFunctionCommand }    from '@aws-sdk/client-lambda';
import { parseArn, type LoggerBuffer }                                from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { OwnershipCheckedDelete }                                     from '../ownership-checked-delete';
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
  private readonly ownershipCheckedDelete: OwnershipCheckedDelete;

  constructor(
    private readonly lambdaClient: LambdaClient,
    private readonly rootStackMembership: RootStackMembership,
    private readonly logger: LoggerBuffer,
  ) {
    this.ownershipCheckedDelete = new OwnershipCheckedDelete(this.results, logger);
  }

  /**
   * Deletes the function when it belongs to the root stack. Resolves to `SUCCESS` once the function is gone
   * (deleted now, or already absent), `FAILED` on a root stack mismatch, and `RETRY` on any other
   * error. Never rejects.
   */
  public async sweep(input: EdgeFunctionRemovalInput): Promise<TargetResult> {
    return this.ownershipCheckedDelete.sweep({
      label:         'Lambda function',
      goneErrorName: 'ResourceNotFoundException',
      // Any other error is retried, because it may be transient, e.g. CloudFront replicas of the function still draining.
      otherErrors:           'retry',
      findRootStackMismatch: () => this.findRootStackMismatch(input),
      deleteResource:        () => this.deleteFunction(input),
    });
  }

  private async findRootStackMismatch(input: EdgeFunctionRemovalInput): Promise<string | undefined> {
    this.logger.debug('Verifying Lambda function belongs to the root stack');
    const getResp = await this.lambdaClient.send(new GetFunctionCommand({ FunctionName: this.functionNameOf(input) }));
    return this.rootStackMembership.mismatchInTagMap(input, 'Lambda function', getResp.Tags);
  }

  private async deleteFunction(input: EdgeFunctionRemovalInput): Promise<TargetResult> {
    this.logger.info('Lambda function belongs to the root stack; attempting delete');
    await this.lambdaClient.send(new DeleteFunctionCommand({ FunctionName: this.functionNameOf(input) }));
    this.logger.info('Lambda function deleted successfully');
    return this.results.done();
  }

  private functionNameOf(input: EdgeFunctionRemovalInput): string {
    return parseArn(input.edgeFnArn).resourceName;
  }
}
