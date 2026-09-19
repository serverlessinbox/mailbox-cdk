import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { S3Client } from '@aws-sdk/client-s3';
import { wrapHandler } from 'aws-custom-resources';
import { withSmokeTest } from '../shared/with-smoke-test';
import { emitManualFinalize } from '../shared/manual-finalize';
import { tryLoad, check } from '../shared/env';
import { LoggerBuffer } from '../shared/logger-buffer';
import { invalidateCloudFront } from '../shared/ui-cloudfront';
import { deletePrefix, deployZipToPrefix, writeObject } from '../shared/content-ops';
import { isParentStackRollingBack } from '../shared/stack-rollback-detector';
import { isContentDeployerResourceProperties } from './types';
import { load } from './config';

const { config, error: configError } = tryLoad(load);
const cloudFront = new CloudFrontClient();
const s3 = new S3Client();

export const handler = withSmokeTest(
  wrapHandler(async (event: any, context: any) => {
    if (configError) {
      if (event.RequestType === 'Delete') {
        new LoggerBuffer().error('Configuration error on Delete; responding SUCCESS so stack deletion is not blocked', { error: configError });
        return { PhysicalResourceId: event.PhysicalResourceId };
      }
      throw new Error(configError);
    }

    const logger = new LoggerBuffer(config.serviceName, config.logLevel);
    logger.debug('CustomResource event received', { requestType: event.RequestType });

    try {
      // Emit finalization details for manual recovery of hung custom resources
      emitManualFinalize(event, { service: config.serviceName });

      const resourceProps = event.ResourceProperties ?? {};
      if (!isContentDeployerResourceProperties(resourceProps)) {
        throw new Error(
          'Invalid ResourceProperties: malformed sources array or invalid property types'
        );
      }
      const props = resourceProps;

      const targetBucket = String(props.targetBucket ?? '').trim();

      // Only require targetBucket when there are sources to deploy
      const sourcesToDeploy = props.sources ?? [];
      if (sourcesToDeploy.length > 0 && !targetBucket) {
        throw new Error('Missing required property: targetBucket');
      }

      const currentPhysicalId = `content-assets:${event.StackId}:${event.LogicalResourceId}`;

      if (event.RequestType === 'Delete') {
        // CFN Delete: no-op. Bucket lifecycle cleanup is managed separately by
        // a bucket-scoped construct, not by individual deployments' CustomResources.
        // On resource replacement (logical-ID bump), CFN calls Delete on the old
        // resource after creating the new one. If we delete here, we'd wipe the
        // objects the new resource just wrote. Simply echo back a stable ID.
        logger.debug('Delete is a no-op for content-deployer');
        return {
          PhysicalResourceId: event.PhysicalResourceId,
          Data: { deleted: '0', objectsWritten: '0', cacheInvalidated: '0' },
        };
      }

      // Create/Update
      const deploymentProps = props as any;

      const sources = deploymentProps.sources ?? [];
      const distributionId = deploymentProps.distributionId ? String(deploymentProps.distributionId) : undefined;
      const invalidationPaths = Array.isArray(deploymentProps.invalidationPaths) ? deploymentProps.invalidationPaths : undefined;

      let objectsWritten = 0;

      // Create/Update: iterate sources and dispatch based on kind
      for (const source of sources) {
        if (source.kind === 'zip') {
          logger.debug('Processing zip source', { targetPrefix: source.targetPrefix });
          // Delete existing prefix (full overwrite)
          await deletePrefix(s3, targetBucket, source.targetPrefix);
          const res = await deployZipToPrefix(s3, {
            sourceBucket: source.sourceBucket,
            sourceKey: source.sourceKey,
            sourceVersionId: source.sourceVersionId,
            targetBucket,
            targetPrefix: source.targetPrefix,
          });
          logger.info('Zip source deployed', { targetPrefix: source.targetPrefix, uploaded: res.uploaded });
          objectsWritten += res.uploaded;
        } else if (source.kind === 'data') {
          logger.debug('Processing data source', { key: source.key });
          // Write exact key with metadata
          await writeObject(s3, {
            targetBucket,
            key: source.key,
            body: source.body,
            contentType: source.contentType,
            cacheControl: source.cacheControl,
          });
          logger.info('Data source deployed', { key: source.key });
          objectsWritten += 1;
        }
      }

      const invalidationRes = await invalidateCloudFront(cloudFront, {
        distributionId,
        paths: invalidationPaths,
        callerReference: JSON.stringify({
          pr: currentPhysicalId,
          n: deploymentProps.deploymentNonce ?? null,
          r: event.RequestId,
          lg: context?.logGroupName ?? null,
        }),
      });

      const cacheInvalidated = invalidationRes?.invalidated ?? 0;

      logger.info('Content deployed', { objectsWritten, cacheInvalidated });
      logger.recordUpdate();

      if (logger.shouldFlush()) {
        logger.flush();
      }

      return {
        PhysicalResourceId: currentPhysicalId,
        Data: {
          deleted: '0',
          objectsWritten: String(objectsWritten),
          cacheInvalidated: String(cacheInvalidated),
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Handler failed', { error: errorMessage });

      // During parent-stack rollback on Update, return SUCCESS to allow rollback to complete
      // instead of failing and leaving the stack in UPDATE_ROLLBACK_FAILED.
      if (event.RequestType === 'Update') {
        const rollingBack = await isParentStackRollingBack(event.StackId, undefined, logger);
        if (rollingBack) {
          logger.warn('Suppressing error during stack rollback', { error: errorMessage });
          logger.flush();
          return { PhysicalResourceId: event.PhysicalResourceId };
        }
      }

      logger.flush();
      throw err;
    }
  }),
  check(load)
);
