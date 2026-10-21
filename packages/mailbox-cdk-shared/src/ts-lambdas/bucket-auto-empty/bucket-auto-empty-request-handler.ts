import type { CustomResourceRequest }                                               from '../../runtime/handler-kit/custom-resource/custom-resource-request';
import { CaughtError }                                                              from '../../runtime/handler-kit/errors/caught-error';
import { ExpectedFailure }                                                          from '../../runtime/handler-kit/errors/expected-failure';
import type { InvocationDeadline }                                                  from '../../runtime/handler-kit/invocation-deadline';
import type { LoggerBuffer }                                                        from '../../runtime/handler-kit/logger-buffer';

import type { BucketEmptier }                                                       from './bucket-emptier';
import { isBucketAutoEmptyDeletionProperties, isBucketAutoEmptyResourceProperties } from './resource-properties';

/** The answer sent to CloudFormation for a request that succeeded. */
export interface BucketAutoEmptyResponse {
  readonly PhysicalResourceId?: string;
  readonly Data?: { readonly deleted: string };
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
    this.logger.debug('CustomResource event received', { requestType: request.RequestType });

    // A Delete needs only the bucket name; no other property can fail it.
    if (request.RequestType === 'Delete') {
      return this.emptyBucketOnDelete(request, deadline);
    }

    this.rejectInvalidProperties(request);

    // Emptying only happens on Delete; Create and Update are no-ops.
    if (request.RequestType === 'Create' || request.RequestType === 'Update') {
      this.logger.debug('Create/Update is a no-op for bucket-auto-empty');
      return this.answerDeleted(this.derivePhysicalResourceId(request), 0);
    }

    throw new ExpectedFailure(`Unknown RequestType: ${request.RequestType}`);
  }

  private rejectInvalidProperties(request: CustomResourceRequest): void {
    const properties = request.ResourceProperties ?? {};
    if (!isBucketAutoEmptyResourceProperties(properties)) {
      throw new ExpectedFailure('Invalid ResourceProperties: bucketName must be a string when present');
    }
  }

  // Without a usable bucket name the bucket cannot be checked, so the Delete fails rather than guessing it is empty.
  private readBucketNameForDelete(request: CustomResourceRequest): string {
    const properties = request.ResourceProperties ?? {};
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
    const physicalResourceId = request.PhysicalResourceId || this.derivePhysicalResourceId(request);

    this.logger.debug('Emptying bucket', { bucketName });
    try {
      const deleted = await this.bucketEmptier.empty(bucketName, deadline);
      this.logger.info('Bucket emptied', { bucketName, deleted });
      return this.answerDeleted(physicalResourceId, deleted);
    } catch (failure) {
      return this.answerEmptyingFailure(physicalResourceId, bucketName, failure);
    }
  }

  // A bucket that is already gone needs no emptying, and failing the Delete would leave the stack in DELETE_FAILED.
  private answerEmptyingFailure(
    physicalResourceId: string,
    bucketName: string,
    failure: unknown,
  ): BucketAutoEmptyResponse {
    if (!new CaughtError(failure).is('NoSuchBucket')) {
      throw failure;
    }
    this.logger.warn('Bucket no longer exists; nothing to empty', { bucketName });
    return this.answerDeleted(physicalResourceId, 0);
  }

  private derivePhysicalResourceId(request: CustomResourceRequest): string {
    return `bucket-auto-empty:${request.StackId}:${request.LogicalResourceId}`;
  }

  private answerDeleted(physicalResourceId: string, deleted: number): BucketAutoEmptyResponse {
    return { PhysicalResourceId: physicalResourceId, Data: { deleted: String(deleted) } };
  }
}
