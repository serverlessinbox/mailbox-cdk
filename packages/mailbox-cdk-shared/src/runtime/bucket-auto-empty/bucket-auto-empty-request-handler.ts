import { toPhysicalResourceId, type PhysicalResourceId } from '../../runtime/handler-kit/custom-resource/custom-resource-identifiers';
import type { CustomResourceRequest }                    from '../../runtime/handler-kit/custom-resource/custom-resource-request';
import { CaughtError }                                   from '../../runtime/handler-kit/errors/caught-error';
import { ExpectedFailure }                               from '../../runtime/handler-kit/errors/expected-failure';
import type { InvocationDeadline }                       from '../../runtime/handler-kit/invocation-deadline';
import type { LoggerBuffer }                             from '../../runtime/handler-kit/logger-buffer';

import type { BucketEmptier }                            from './bucket-emptier';
import {
  isBucketAutoEmptyDeletionProperties,
  isBucketAutoEmptyResourceProperties,
}                                                       from './resource-properties';

/** The attributes a bucket-auto-empty resource returns, all as strings. A type alias, because `wrapHandler` requires `Data` to be a `Record<string, string>`. */
export type BucketAutoEmptyResponseData = {
  readonly deleted: string;
};

/** The answer sent to CloudFormation for a request that succeeded. */
export interface BucketAutoEmptyResponse {
  readonly PhysicalResourceId: PhysicalResourceId;
  readonly Data: BucketAutoEmptyResponseData;
}

/**
 * Answers the custom-resource requests of one bucket-auto-empty invocation: empties the bucket on Delete
 * and does nothing on Create and Update. A request it rejects on purpose is thrown as an
 * `ExpectedFailure`; any other error comes from a failed call and is unexpected. A Delete whose bucket no
 * longer exists is answered as done, because there is nothing left to empty.
 */
export class BucketAutoEmptyRequestHandler {
  private readonly bucketEmptier: BucketEmptier;
  private readonly logger: LoggerBuffer;

  constructor(bucketEmptier: BucketEmptier, logger: LoggerBuffer) {
    this.bucketEmptier = bucketEmptier;
    this.logger        = logger;
  }

  async handle(request: CustomResourceRequest, deadline: InvocationDeadline): Promise<BucketAutoEmptyResponse> {
    // A Delete needs only the bucket name; no other property can fail it.
    if (request.RequestType === 'Delete') {
      return this.emptyBucketOnDelete(request, deadline);
    }

    this.rejectInvalidProperties(request);

    if (request.RequestType === 'Create' || request.RequestType === 'Update') {
      return this.answerNothingToEmpty(request);
    }

    throw new ExpectedFailure(`Unknown RequestType: ${request.RequestType}`);
  }

  private readProperties(request: CustomResourceRequest): unknown {
    this.logger.debug('CustomResource event received', { requestType: request.RequestType });
    return request.ResourceProperties ?? {};
  }

  private rejectInvalidProperties(request: CustomResourceRequest): void {
    if (!isBucketAutoEmptyResourceProperties(this.readProperties(request))) {
      throw new ExpectedFailure('Invalid ResourceProperties: bucketName must be a string when present');
    }
  }

  // Without a usable bucket name the bucket cannot be checked, so the Delete fails rather than guessing it is empty.
  private readBucketNameForDelete(request: CustomResourceRequest): string {
    const properties = this.readProperties(request);
    const bucketName = isBucketAutoEmptyDeletionProperties(properties) ? properties.bucketName.trim() : '';
    if (!bucketName) {
      throw new ExpectedFailure('Cannot check the bucket: bucketName is missing, blank or not a string');
    }
    return bucketName;
  }

  private async emptyBucketOnDelete(
    request: CustomResourceRequest,
    deadline: InvocationDeadline,
  ): Promise<BucketAutoEmptyResponse> {
    const bucketName         = this.readBucketNameForDelete(request);
    const physicalResourceId = this.physicalResourceIdOf(request);

    this.logger.debug('Emptying bucket', { bucketName });
    try {
      const deleted = await this.bucketEmptier.empty(bucketName, deadline);
      this.logger.info('Bucket emptied', { bucketName, deleted });
      return this.answerEmptied(physicalResourceId, deleted);
    } catch (failure) {
      return this.answerEmptyingFailure(physicalResourceId, bucketName, failure);
    }
  }

  // A bucket that is already gone needs no emptying, and failing the Delete would leave the stack in DELETE_FAILED.
  private answerEmptyingFailure(
    physicalResourceId: PhysicalResourceId,
    bucketName: string,
    failure: unknown,
  ): BucketAutoEmptyResponse {
    if (!new CaughtError(failure).is('NoSuchBucket')) {
      throw failure;
    }
    this.logger.warn('Bucket no longer exists; nothing to empty', { bucketName });
    return this.answerEmptied(physicalResourceId, 0);
  }

  private answerNothingToEmpty(request: CustomResourceRequest): BucketAutoEmptyResponse {
    this.logger.debug('Create/Update is a no-op for bucket-auto-empty');
    return this.answerEmptied(this.derivePhysicalResourceId(request), 0);
  }

  private physicalResourceIdOf(request: CustomResourceRequest): PhysicalResourceId {
    return request.PhysicalResourceId
      ? toPhysicalResourceId(request.PhysicalResourceId)
      : this.derivePhysicalResourceId(request);
  }

  private derivePhysicalResourceId(request: CustomResourceRequest): PhysicalResourceId {
    return toPhysicalResourceId(`bucket-auto-empty:${request.StackId}:${request.LogicalResourceId}`);
  }

  private answerEmptied(physicalResourceId: PhysicalResourceId, deleted: number): BucketAutoEmptyResponse {
    return { PhysicalResourceId: physicalResourceId, Data: { deleted: String(deleted) } };
  }
}
