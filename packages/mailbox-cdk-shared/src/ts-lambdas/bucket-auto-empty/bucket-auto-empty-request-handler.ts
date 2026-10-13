import type { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { ExpectedFailure } from '../shared/expected-failure';
import type { LoggerBuffer } from '../shared/logger-buffer';
import { isParentStackRollingBack } from '../shared/stack-rollback-detector';
import type { BucketEmptier } from './bucket-emptier';
import {
  isBucketAutoEmptyResourceProperties,
  type BucketAutoEmptyResourceProperties,
} from './resource-properties';

/** The fields of a CloudFormation custom-resource request that this Lambda reads. */
export interface BucketAutoEmptyRequest {
  readonly RequestType: string;
  readonly StackId: string;
  readonly LogicalResourceId: string;
  readonly PhysicalResourceId?: string;
  readonly ResourceProperties?: unknown;
}

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
  private readonly cloudFormation: CloudFormationClient;
  private readonly logger: LoggerBuffer;

  constructor(bucketEmptier: BucketEmptier, cloudFormation: CloudFormationClient, logger: LoggerBuffer) {
    this.bucketEmptier = bucketEmptier;
    this.cloudFormation = cloudFormation;
    this.logger = logger;
  }

  async handle(request: BucketAutoEmptyRequest): Promise<BucketAutoEmptyResponse> {
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

  /**
   * Logs the failure and returns the answer that suppresses it, or undefined when the failure stands.
   * CloudFormation re-sends Update with the old properties while the parent stack rolls back, and
   * answering FAILED to that strands the stack in UPDATE_ROLLBACK_FAILED.
   */
  async answerFailedRequest(
    request: BucketAutoEmptyRequest,
    failure: unknown,
  ): Promise<BucketAutoEmptyResponse | undefined> {
    const reason = failure instanceof Error ? failure.message : String(failure);
    this.logger.error('Handler failed', { error: reason });

    if (request.RequestType !== 'Update') {
      return undefined;
    }

    const rollingBack = await isParentStackRollingBack(request.StackId, this.cloudFormation, this.logger);
    if (!rollingBack) {
      return undefined;
    }

    this.logger.warn('Suppressing error during stack rollback', { error: reason });
    return { PhysicalResourceId: request.PhysicalResourceId };
  }

  private readProperties(request: BucketAutoEmptyRequest): BucketAutoEmptyResourceProperties {
    const properties = request.ResourceProperties ?? {};
    if (!isBucketAutoEmptyResourceProperties(properties)) {
      throw new ExpectedFailure('Invalid ResourceProperties: bucketName must be a string when present');
    }
    return properties;
  }

  private async emptyBucketOnDelete(
    request: BucketAutoEmptyRequest,
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

  private derivePhysicalResourceId(request: BucketAutoEmptyRequest): string {
    return `bucket-auto-empty:${request.StackId}:${request.LogicalResourceId}`;
  }

  private answerDeleted(physicalResourceId: string, deleted: number): BucketAutoEmptyResponse {
    return { PhysicalResourceId: physicalResourceId, Data: { deleted: String(deleted) } };
  }
}
