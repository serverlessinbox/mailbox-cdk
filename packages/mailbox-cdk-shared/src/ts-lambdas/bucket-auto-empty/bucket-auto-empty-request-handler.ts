import type { CustomResourceRequest } from '../shared/custom-resource-request';
import { ExpectedFailure } from '../shared/expected-failure';
import type { LoggerBuffer } from '../shared/logger-buffer';
import type { BucketEmptier } from './bucket-emptier';
import {
  isBucketAutoEmptyResourceProperties,
  type BucketAutoEmptyResourceProperties,
} from './resource-properties';

/** The answer sent to CloudFormation for a request that succeeded. */
export interface BucketAutoEmptyResponse {
  readonly PhysicalResourceId?: string;
  readonly Data?: { readonly deleted: string };
}

/**
 * Answers the custom-resource requests of one bucket-auto-empty invocation: empties the bucket on Delete
 * and does nothing on Create and Update. A request it rejects on purpose is thrown as an
 * `ExpectedFailure`; any other error comes from a failed call and is unexpected.
 */
export class BucketAutoEmptyRequestHandler {
  private readonly bucketEmptier: BucketEmptier;
  private readonly logger: LoggerBuffer;

  constructor(bucketEmptier: BucketEmptier, logger: LoggerBuffer) {
    this.bucketEmptier = bucketEmptier;
    this.logger = logger;
  }

  async handle(request: CustomResourceRequest): Promise<BucketAutoEmptyResponse> {
    this.logger.debug('CustomResource event received', { requestType: request.RequestType });

    const properties = this.readProperties(request);

    // Emptying only happens on Delete; Create and Update are no-ops.
    if (request.RequestType === 'Create' || request.RequestType === 'Update') {
      this.logger.debug('Create/Update is a no-op for bucket-auto-empty');
      return this.answerDeleted(this.derivePhysicalResourceId(request), 0);
    }

    if (request.RequestType === 'Delete') {
      return this.emptyBucketOnDelete(request, properties);
    }

    throw new ExpectedFailure(`Unknown RequestType: ${request.RequestType}`);
  }

  private readProperties(request: CustomResourceRequest): BucketAutoEmptyResourceProperties {
    const properties = request.ResourceProperties ?? {};
    if (!isBucketAutoEmptyResourceProperties(properties)) {
      throw new ExpectedFailure('Invalid ResourceProperties: bucketName must be a string when present');
    }
    return properties;
  }

  private async emptyBucketOnDelete(
    request: CustomResourceRequest,
    properties: BucketAutoEmptyResourceProperties,
  ): Promise<BucketAutoEmptyResponse> {
    const bucketName = (properties.bucketName ?? '').trim();
    if (!bucketName) {
      throw new ExpectedFailure('Missing required property: bucketName');
    }

    this.logger.debug('Emptying bucket', { bucketName });
    const deleted = await this.bucketEmptier.empty(bucketName);
    this.logger.info('Bucket emptied', { bucketName, deleted });

    return this.answerDeleted(request.PhysicalResourceId || this.derivePhysicalResourceId(request), deleted);
  }

  private derivePhysicalResourceId(request: CustomResourceRequest): string {
    return `bucket-auto-empty:${request.StackId}:${request.LogicalResourceId}`;
  }

  private answerDeleted(physicalResourceId: string, deleted: number): BucketAutoEmptyResponse {
    return { PhysicalResourceId: physicalResourceId, Data: { deleted: String(deleted) } };
  }
}
