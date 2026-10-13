import type { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import type { S3Client } from '@aws-sdk/client-s3';
import { deletePrefix, deployZipToPrefix, writeObject } from '../shared/content-ops';
import type { CustomResourceRequest } from '../shared/custom-resource-request';
import { ExpectedFailure } from '../shared/expected-failure';
import type { LoggerBuffer } from '../shared/logger-buffer';
import { invalidateCloudFront } from '../shared/ui-cloudfront';
import {
  isContentDeployerResourceProperties,
  type ContentDeployerResourceProperties,
  type DataSourceSpec,
  type StaticContentSourceSpec,
  type ZipSourceSpec,
} from './resource-properties';

/** The attributes a content-deployer resource returns, all as strings. A type alias, because `wrapHandler` requires `Data` to be a `Record<string, string>`. */
export type ContentDeployerResponseData = {
  readonly deleted: string;
  readonly objectsWritten: string;
  readonly cacheInvalidated: string;
};

/** The answer sent to CloudFormation for a request that succeeded. */
export interface ContentDeployerResponse {
  readonly PhysicalResourceId?: string;
  readonly Data?: ContentDeployerResponseData;
}

/**
 * Answers the custom-resource requests of one content-deployer invocation: Create and Update write each
 * source into the target bucket and then invalidate the CloudFront paths, Delete does nothing. A request it
 * rejects on purpose is thrown as an `ExpectedFailure`; any other error comes from a failed call and is
 * unexpected.
 */
export class ContentDeployerRequestHandler {
  private readonly s3: S3Client;
  private readonly cloudFront: CloudFrontClient;
  private readonly logger: LoggerBuffer;

  constructor(s3: S3Client, cloudFront: CloudFrontClient, logger: LoggerBuffer) {
    this.s3 = s3;
    this.cloudFront = cloudFront;
    this.logger = logger;
  }

  async handle(request: CustomResourceRequest, logGroupName: string): Promise<ContentDeployerResponse> {
    const properties = this.readProperties(request);
    const targetBucket = this.readTargetBucket(properties);

    // Deleting a deployment keeps its objects: when a resource is replaced, CloudFormation deletes the old
    // one after the new one has written, and cleaning up here would wipe what the new one just wrote.
    if (request.RequestType === 'Delete') {
      return this.answerDeleted(request);
    }

    const objectsWritten = await this.deploySources(properties.sources ?? [], targetBucket);
    const cacheInvalidated = await this.invalidateCache(request, properties, logGroupName);

    return this.answerDeployed(request, objectsWritten, cacheInvalidated);
  }

  private readProperties(request: CustomResourceRequest): ContentDeployerResourceProperties {
    this.logger.debug('CustomResource event received', { requestType: request.RequestType });

    const properties = request.ResourceProperties ?? {};
    if (!isContentDeployerResourceProperties(properties)) {
      throw new ExpectedFailure('Invalid ResourceProperties: malformed sources array or invalid property types');
    }
    return properties;
  }

  // A resource that only invalidates has no sources, so only a resource with sources needs a bucket.
  private readTargetBucket(properties: ContentDeployerResourceProperties): string {
    const targetBucket = (properties.targetBucket ?? '').trim();
    if ((properties.sources ?? []).length > 0 && !targetBucket) {
      throw new ExpectedFailure('Missing required property: targetBucket');
    }
    return targetBucket;
  }

  private async deploySources(sources: StaticContentSourceSpec[], targetBucket: string): Promise<number> {
    let objectsWritten = 0;
    for (const source of sources) {
      objectsWritten += await this.deploySource(source, targetBucket);
    }
    return objectsWritten;
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
      sourceBucket: source.sourceBucket,
      sourceKey: source.sourceKey,
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
      key: source.key,
      body: source.body,
      contentType: source.contentType,
      cacheControl: source.cacheControl,
    });

    this.logger.info('Data source deployed', { key: source.key });
    return 1;
  }

  private async invalidateCache(
    request: CustomResourceRequest,
    properties: ContentDeployerResourceProperties,
    logGroupName: string,
  ): Promise<boolean> {
    const { invalidated } = await invalidateCloudFront(this.cloudFront, {
      distributionId: properties.distributionId,
      paths: properties.invalidationPaths,
      callerReference: JSON.stringify({
        pr: this.derivePhysicalResourceId(request),
        n: properties.deploymentNonce ?? null,
        r: request.RequestId,
        lg: logGroupName,
      }),
    });
    return invalidated;
  }

  private derivePhysicalResourceId(request: CustomResourceRequest): string {
    return `content-assets:${request.StackId}:${request.LogicalResourceId}`;
  }

  private answerDeleted(request: CustomResourceRequest): ContentDeployerResponse {
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
    physicalResourceId: string | undefined,
    objectsWritten: number,
    cacheInvalidated: string,
  ): ContentDeployerResponse {
    return {
      PhysicalResourceId: physicalResourceId,
      Data: { deleted: '0', objectsWritten: String(objectsWritten), cacheInvalidated },
    };
  }
}
