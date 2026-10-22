import { CaughtError }                                      from '../errors/caught-error';
import { ExpectedFailure }                                  from '../errors/expected-failure';
import type { LoggerBuffer }                                from '../logger-buffer';

import type { CustomResourceAnswer, CustomResourceRequest } from './custom-resource-request';
import type { ParentStackStatus }                           from './parent-stack-status';

/**
 * Decides the answer to a custom-resource request that failed. It suppresses only an Update that fails while
 * the parent stack rolls back; every other failure stands.
 */
export class FailedRequestAnswerer {
  private readonly parentStackStatus: ParentStackStatus;
  private readonly logger: LoggerBuffer;

  constructor(parentStackStatus: ParentStackStatus, logger: LoggerBuffer) {
    this.parentStackStatus = parentStackStatus;
    this.logger            = logger;
  }

  /**
   * Returns the answer that suppresses the failure, or undefined when the failure stands. A failure the code
   * did not recognise is logged at error level.
   * CloudFormation re-sends Update with the old properties while the parent stack rolls back, and
   * answering FAILED to that strands the stack in UPDATE_ROLLBACK_FAILED.
   */
  public async answer(request: CustomResourceRequest, failure: unknown): Promise<CustomResourceAnswer | undefined> {
    const reason = new CaughtError(failure).readableMessage();
    if (!(failure instanceof ExpectedFailure)) {
      this.logger.error('Handler failed', { error: reason });
    }

    if (request.RequestType !== 'Update') {
      return undefined;
    }

    if (!(await this.parentStackStatus.isRollingBack(request.StackId))) {
      return undefined;
    }

    this.logger.warn('Suppressing error during stack rollback', { error: reason });
    return { PhysicalResourceId: request.PhysicalResourceId };
  }
}
