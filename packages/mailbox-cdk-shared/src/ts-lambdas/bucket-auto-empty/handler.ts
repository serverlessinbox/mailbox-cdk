import { wrapHandler } from 'aws-custom-resources';
import { withSmokeTest } from '../shared/with-smoke-test';
import { emptyBucket } from '../shared/bucket-empty';
import { emitManualFinalize } from '../shared/manual-finalize';
import * as env from '../shared/env';
import { isBucketAutoEmptyResourceProperties } from './types';

export const handler = withSmokeTest(wrapHandler(async (event: any, _context: any) => {
  // Read SERVICE_NAME at entry point; thread to sub-functions
  // BWCOMPAT(2026-09-01): SERVICE_NAME read as optional — no already-deployed template sets it.
  // Remove when: every live stack has had a Path 2 template update on/after 2026-09-01.
  const service = env.get('SERVICE_NAME', undefined);

  // Emit finalization details for manual recovery of hung custom resources
  emitManualFinalize(event, { service });

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

    // Empty the bucket: list all versions (including delete markers) and delete them all
    const deleted = await emptyBucket(bucketName);

    return {
      PhysicalResourceId: event.PhysicalResourceId || currentPhysicalId,
      Data: { deleted: String(deleted) },
    };
  }

  throw new Error(`Unknown RequestType: ${event.RequestType}`);
}));
