import { CaughtError, type LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { TargetResult }              from './removal';
import type { TargetResults }             from './target-results';

/** The error names AWS services answer with when the resource they were asked about does not exist. */
export type GoneErrorName = 'ResourceNotFoundException' | 'NoSuchEntityException';

/** What an error other than "gone" makes of the sweep: another attempt later, or the end of it. */
export type OtherErrorOutcome = 'retry' | 'failed';

/** One resource to delete only when the root stack owns it: how to read its ownership, how to delete it, how its failures are read. */
export interface OwnedResource {
  /** Names the resource in log lines. */
  readonly label:         string;
  readonly goneErrorName: GoneErrorName;
  readonly otherErrors:   OtherErrorOutcome;

  /** Reads the resource's tags and resolves to the reason it does not belong to the root stack, or undefined when it does. */
  findRootStackMismatch(): Promise<string | undefined>;

  /** Deletes the resource, once ownership is established; resolves to the outcome (done, or retry when it cannot be deleted yet). */
  deleteResource(): Promise<TargetResult>;
}

/**
 * The sweep every removal shares: delete a resource only when the root stack owns it, treat a resource that is
 * gone as swept, and answer any other failure as the resource says. It does not read tags or call a delete itself.
 */
export class OwnershipCheckedDelete {
  private readonly results: TargetResults;
  private readonly logger: LoggerBuffer;

  constructor(results: TargetResults, logger: LoggerBuffer) {
    this.results = results;
    this.logger  = logger;
  }

  /** Resolves to the outcome of sweeping `resource`; never rejects. */
  public async sweep(resource: OwnedResource): Promise<TargetResult> {
    try {
      return await this.deleteWhenOwned(resource);
    } catch (thrown) {
      return this.resultOfFailure(resource, thrown);
    }
  }

  private async deleteWhenOwned(resource: OwnedResource): Promise<TargetResult> {
    const mismatch = await resource.findRootStackMismatch();
    // Never delete what belongs to another stack. A mismatch is final, so it is not retried.
    if (mismatch) {
      return this.results.failed(mismatch);
    }

    return resource.deleteResource();
  }

  private resultOfFailure(resource: OwnedResource, thrown: unknown): TargetResult {
    const error = new CaughtError(thrown);
    // A resource that is gone is what the sweep is after, so it counts as swept.
    if (error.is(resource.goneErrorName)) {
      this.logger.debug(`${resource.label} not found; treating as deleted`);
      return this.results.done();
    }

    if (resource.otherErrors === 'retry') {
      this.logger.warn(`${resource.label} deletion error (will retry)`, { errorName: error.name, errorMessage: error.message });
      return this.results.retry(error.describe());
    }

    this.logger.error(`${resource.label} deletion error`, { errorName: error.name, errorMessage: error.message });
    return this.results.failed(error.describe());
  }
}
