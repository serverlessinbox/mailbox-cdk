import type { CloudFrontClient }                         from '@aws-sdk/client-cloudfront';
import type { S3Client }                                 from '@aws-sdk/client-s3';

import { invalidateCloudFront }                          from '../../runtime/handler-kit/cloudfront-invalidation';
import { deletePrefix, deployZipToPrefix, writeObject }  from '../../runtime/handler-kit/content-ops';
import { toPhysicalResourceId, type PhysicalResourceId } from '../../runtime/handler-kit/custom-resource/custom-resource-identifiers';
import type { CustomResourceRequest, DeleteRequest }     from '../../runtime/handler-kit/custom-resource/custom-resource-request';
import { ExpectedFailure }                               from '../../runtime/handler-kit/errors/expected-failure';
import { InvalidOwnInput }                               from '../../runtime/handler-kit/errors/invalid-own-input';
import { hasTimeLeft, type InvocationDeadline }          from '../../runtime/handler-kit/invocation-deadline';
import type { LoggerBuffer }                             from '../../runtime/handler-kit/logger-buffer';

import {
  isContentDeployerResourceProperties,
  type ContentDeployerResourceProperties,
  type DataSourceSpec,
  type StaticContentSourceSpec,
  type ZipSourceSpec,
} from './resource-properties';

/** The attributes a content-deployer resource returns, all as strings. A type alias, because `wrapHandler` requires `Data` to be a `Record<string, string>`. */
export type ContentDeployerResponseData = {
  readonly deleted:          string;
  readonly objectsWritten:   string;
  readonly cacheInvalidated: string;
};

/** The answer sent to CloudFormation for a request that succeeded. */
export interface ContentDeployerResponse {
  readonly PhysicalResourceId?: PhysicalResourceId;
  readonly Data?:               ContentDeployerResponseData;
}

/**
 * Answers the custom-resource requests of one content-deployer invocation: Create and Update write each
 * source into the target bucket and then invalidate the CloudFront paths, Delete does nothing. A deployment
 * the invocation has too little time left to finish is thrown as an `ExpectedFailure`. Properties our own
 * template should never have written are thrown as an `InvalidOwnInput`, a defect that carries them; any other
 * error comes from a failed call and is unexpected.
 */
export class ContentDeployerRequestHandler {
  private readonly s3: S3Client;
  private readonly cloudFront: CloudFrontClient;
  private readonly logger: LoggerBuffer;

  constructor(s3: S3Client, cloudFront: CloudFrontClient, logger: LoggerBuffer) {
    this.s3         = s3;
    this.cloudFront = cloudFront;
    this.logger     = logger;
  }

  async handle(request: CustomResourceRequest, deadline: InvocationDeadline): Promise<ContentDeployerResponse> {
    // Deleting a deployment keeps its objects: when a resource is replaced, CloudFormation deletes the old
    // one after the new one has written, and cleaning up here would wipe what the new one just wrote.
    // The properties are not read, so a Delete cannot fail on them.
    if (request.RequestType === 'Delete') {
      return this.answerDeleted(request);
    }

    const properties       = this.readProperties(request);
    const targetBucket     = this.readTargetBucket(properties);
    const objectsWritten   = await this.deploySources(properties.sources ?? [], targetBucket, deadline);
    const cacheInvalidated = await this.invalidateCache(request, properties, deadline);

    return this.answerDeployed(request, objectsWritten, cacheInvalidated);
  }

  private readProperties(request: CustomResourceRequest): ContentDeployerResourceProperties {
    this.logger.debug('CustomResource event received', { requestType: request.RequestType });

    const properties       = request.ResourceProperties ?? {};
    const errors: string[] = [];
    if (!isContentDeployerResourceProperties(properties, { errors })) {
      throw new InvalidOwnInput('Invalid ResourceProperties', errors, properties);
    }
    return properties;
  }

  // A resource that only invalidates has no sources, so only a resource with sources needs a bucket.
  private readTargetBucket(properties: ContentDeployerResourceProperties): string {
    const targetBucket = (properties.targetBucket ?? '').trim();
    if ((properties.sources ?? []).length > 0 && !targetBucket) {
      throw new InvalidOwnInput('Invalid ResourceProperties', ['.targetBucket is required when there are sources'], properties);
    }
    return targetBucket;
  }

  private async deploySources(
    sources: StaticContentSourceSpec[],
    targetBucket: string,
    deadline: InvocationDeadline,
  ): Promise<number> {
    let objectsWritten = 0;
    for (const [index, source] of sources.entries()) {
      this.assertTimeLeft(
        deadline,
        `${index} of ${sources.length} sources were deployed; the remaining sources and the cache invalidation were not run`,
      );
      objectsWritten += await this.deploySource(source, targetBucket);
    }
    return objectsWritten;
  }

  // An unanswered request keeps the stack waiting out the service timeout, so a deployment that cannot finish says so.
  private assertTimeLeft(deadline: InvocationDeadline, unfinished: string): void {
    if (!hasTimeLeft(deadline)) {
      throw new ExpectedFailure(`Content was not fully deployed before the Lambda deadline: ${unfinished}`);
    }
  }

  private deploySource(source: StaticContentSourceSpec, targetBucket: string): Promise<number> {
    if (source.kind === 'zip') {
      return this.deployZipSource(source, targetBucket);
    }
    return this.deployDataSource(source, targetBucket);
  }

  private async deployZipSource(source: ZipSourceSpec, targetBucket: string): Promise<number> {
    this.logger.debug('Processing zip source', { targetPrefix: source.targetPrefix });

    // The prefix is emptied first so the deployment is a full overwrite.
    await deletePrefix(this.s3, targetBucket, source.targetPrefix);
    const { uploaded } = await deployZipToPrefix(this.s3, {
      sourceBucket:    source.sourceBucket,
      sourceKey:       source.sourceKey,
      sourceVersionId: source.sourceVersionId,
      targetBucket,
      targetPrefix: source.targetPrefix,
    });

    this.logger.info('Zip source deployed', { targetPrefix: source.targetPrefix, uploaded });
    return uploaded;
  }

  private async deployDataSource(source: DataSourceSpec, targetBucket: string): Promise<number> {
    this.logger.debug('Processing data source', { key: source.key });

    await writeObject(this.s3, {
      targetBucket,
      key:          source.key,
      body:         source.body,
      contentType:  source.contentType,
      cacheControl: source.cacheControl,
    });

    this.logger.info('Data source deployed', { key: source.key });
    return 1;
  }

  private async invalidateCache(
    request: CustomResourceRequest,
    properties: ContentDeployerResourceProperties,
    deadline: InvocationDeadline,
  ): Promise<boolean> {
    this.assertTimeLeft(deadline, 'all sources were deployed; the cache invalidation was not run');

    const { invalidated } = await invalidateCloudFront(this.cloudFront, {
      distributionId:  properties.distributionId,
      paths:           properties.invalidationPaths,
      callerReference: request.RequestId,
    });
    return invalidated;
  }

  private derivePhysicalResourceId(request: CustomResourceRequest): PhysicalResourceId {
    return toPhysicalResourceId(`content-assets:${request.StackId}:${request.LogicalResourceId}`);
  }

  private answerDeleted(request: DeleteRequest): ContentDeployerResponse {
    this.logger.debug('Delete is a no-op for content-deployer');
    return this.answer(request.PhysicalResourceId, 0, '0');
  }

  private answerDeployed(
    request: CustomResourceRequest,
    objectsWritten: number,
    cacheInvalidated: boolean,
  ): ContentDeployerResponse {
    this.logger.info('Content deployed', { objectsWritten, cacheInvalidated });
    return this.answer(this.derivePhysicalResourceId(request), objectsWritten, String(cacheInvalidated));
  }

  private answer(
    physicalResourceId: PhysicalResourceId | undefined,
    objectsWritten: number,
    cacheInvalidated: string,
  ): ContentDeployerResponse {
    return {
      PhysicalResourceId: physicalResourceId,
      Data:               { deleted: '0', objectsWritten: String(objectsWritten), cacheInvalidated },
    };
  }
}
