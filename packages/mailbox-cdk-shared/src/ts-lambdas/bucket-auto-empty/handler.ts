import { wrapHandler } from 'aws-custom-resources';
import { withSmokeTest } from '../shared/with-smoke-test';
import { emptyBucket } from '../shared/bucket-empty';
import { emitManualFinalize } from '../shared/manual-finalize';
import { tryLoad, check } from '../shared/env';
import { LoggerBuffer } from '../shared/logger-buffer';
import { isParentStackRollingBack } from '../shared/stack-rollback-detector';
import { isBucketAutoEmptyResourceProperties } from './types';
import { load } from './config';

const { config, error: configError } = tryLoad(load);

export const handler = withSmokeTest(
  wrapHandler(async (event: any, _context: any) => {
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
      if (!isBucketAutoEmptyResourceProperties(resourceProps)) {
        throw new Error('Invalid ResourceProperties: bucketName must be a string when present');
      }
      const props = resourceProps;

      const bucketName = String(props.bucketName ?? '').trim();

      // Stable physical resource ID, combining stack and logical resource IDs
      const currentPhysicalId = `bucket-auto-empty:${event.StackId}:${event.LogicalResourceId}`;

      if (event.RequestType === 'Create' || event.RequestType === 'Update') {
        // Create/Update: no-op. Bucket emptying only happens on Delete.
        logger.debug('Create/Update is a no-op for bucket-auto-empty');
        return {
          PhysicalResourceId: currentPhysicalId,
          Data: { deleted: '0' },
        };
      }

      if (event.RequestType === 'Delete') {
        // Validate bucketName is present for Delete
        if (!bucketName) {
          throw new Error('Missing required property: bucketName');
        }

        logger.debug('Emptying bucket', { bucketName });

        // Empty the bucket: list all versions (including delete markers) and delete them all
        const deleted = await emptyBucket(bucketName);

        logger.info('Bucket emptied', { bucketName, deleted });
        logger.recordUpdate();

        if (logger.shouldFlush()) {
          logger.flush();
        }

        return {
          PhysicalResourceId: event.PhysicalResourceId || currentPhysicalId,
          Data: { deleted: String(deleted) },
        };
      }

      throw new Error(`Unknown RequestType: ${event.RequestType}`);
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
