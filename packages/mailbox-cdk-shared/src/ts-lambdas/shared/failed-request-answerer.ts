import type { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { toStackId } from './custom-resource-identifiers';
import type { CustomResourceAnswer, CustomResourceRequest } from './custom-resource-request';
import type { LoggerBuffer } from './logger-buffer';
import { isParentStackRollingBack } from './stack-rollback-detector';

/**
 * Decides the answer to a custom-resource request that failed. It suppresses only an Update that fails while
 * the parent stack rolls back; every other failure stands.
 */
export class FailedRequestAnswerer {
  private readonly cloudFormation: CloudFormationClient;
  private readonly logger: LoggerBuffer;

  constructor(cloudFormation: CloudFormationClient, logger: LoggerBuffer) {
    this.cloudFormation = cloudFormation;
    this.logger = logger;
  }

  /**
   * Logs the failure and returns the answer that suppresses it, or undefined when the failure stands.
   * CloudFormation re-sends Update with the old properties while the parent stack rolls back, and
   * answering FAILED to that strands the stack in UPDATE_ROLLBACK_FAILED.
   */
  async answer(request: CustomResourceRequest, failure: unknown): Promise<CustomResourceAnswer | undefined> {
    const reason = failure instanceof Error ? failure.message : String(failure);
    this.logger.error('Handler failed', { error: reason });

    if (request.RequestType !== 'Update') {
      return undefined;
    }

    const rollingBack = await isParentStackRollingBack(toStackId(request.StackId), this.cloudFormation, this.logger);
    if (!rollingBack) {
      return undefined;
    }

    this.logger.warn('Suppressing error during stack rollback', { error: reason });
    return { PhysicalResourceId: request.PhysicalResourceId };
  }
}
