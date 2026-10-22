import { CaughtError }                                      from '../errors/caught-error';
import { ExpectedFailure }                                  from '../errors/expected-failure';
import type { LoggerBuffer }                                from '../logger-buffer';

import type { PhysicalResourceId }                          from './custom-resource-identifiers';
import type { CustomResourceAnswer, CustomResourceRequest } from './custom-resource-request';
import type { ParentStackStatus }                           from './parent-stack-status';

/** The attributes a custom resource reports to CloudFormation, which the template reads through `GetAtt`. */
export type SuppressedAnswerData = Readonly<Record<string, string>>;

/** The answer that suppresses a failure: the unchanged physical id and, for a resource with attributes, their values. */
export interface SuppressedAnswer extends CustomResourceAnswer {
  readonly Data?: SuppressedAnswerData;
}

/**
 * Decides the answer to a custom-resource request that failed. It suppresses only an Update that fails while
 * the parent stack rolls back; every other failure stands.
 */
export class FailedRequestAnswerer {
  private readonly parentStackStatus: ParentStackStatus;
  private readonly logger: LoggerBuffer;
  private readonly suppressedData: SuppressedAnswerData | undefined;

  /** A resource whose attributes other resources read passes the `suppressedData` its suppressed answer reports. */
  constructor(parentStackStatus: ParentStackStatus, logger: LoggerBuffer, suppressedData?: SuppressedAnswerData) {
    this.parentStackStatus = parentStackStatus;
    this.logger            = logger;
    this.suppressedData    = suppressedData;
  }

  /**
   * Returns the answer that suppresses the failure, or undefined when the failure stands. A failure the code
   * did not recognise is logged at error level.
   * CloudFormation re-sends Update with the old properties while the parent stack rolls back, and
   * answering FAILED to that strands the stack in UPDATE_ROLLBACK_FAILED.
   */
  public async answer(request: CustomResourceRequest, failure: unknown): Promise<SuppressedAnswer | undefined> {
    const reason = CaughtError.readableMessage(failure);
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
    return this.suppressedAnswer(request.PhysicalResourceId);
  }

  private suppressedAnswer(physicalResourceId: PhysicalResourceId): SuppressedAnswer {
    if (this.suppressedData === undefined) {
      return { PhysicalResourceId: physicalResourceId };
    }
    return { PhysicalResourceId: physicalResourceId, Data: this.suppressedData };
  }
}
