import type { CloudFormationClient }                        from '@aws-sdk/client-cloudformation';

import { CaughtError }                                      from '../errors/caught-error';
import { ExpectedFailure }                                  from '../errors/expected-failure';
import type { LoggerBuffer }                                from '../logger-buffer';

import { toStackId }                                        from './custom-resource-identifiers';
import type { CustomResourceAnswer, CustomResourceRequest } from './custom-resource-request';
import { isParentStackRollingBack }                         from './custom-resource-rollback-detector';

/**
 * Decides the answer to a custom-resource request that failed. It suppresses only an Update that fails while
 * the parent stack rolls back; every other failure stands.
 */
export class FailedRequestAnswerer {
  private readonly cloudFormation: CloudFormationClient;
  private readonly logger: LoggerBuffer;

  constructor(cloudFormation: CloudFormationClient, logger: LoggerBuffer) {
    this.cloudFormation = cloudFormation;
    this.logger         = logger;
  }

  /**
   * Returns the answer that suppresses the failure, or undefined when the failure stands. A failure the code
   * did not recognise is logged at error level.
   * CloudFormation re-sends Update with the old properties while the parent stack rolls back, and
   * answering FAILED to that strands the stack in UPDATE_ROLLBACK_FAILED.
   */
  public async answer(request: CustomResourceRequest, failure: unknown): Promise<CustomResourceAnswer | undefined> {
    const reason = new CaughtError(failure).message ?? String(failure);
    this.logUnexpected(failure, reason);

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

  private logUnexpected(failure: unknown, reason: string): void {
    if (!(failure instanceof ExpectedFailure)) {
      this.logger.error('Handler failed', { error: reason });
    }
  }
}
