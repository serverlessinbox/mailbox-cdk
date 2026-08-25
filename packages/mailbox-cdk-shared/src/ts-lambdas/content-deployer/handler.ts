import { wrapHandler } from 'aws-custom-resources';
import { withSmokeTest } from '../shared/with-smoke-test';

import { invalidateCloudFront } from '../shared/ui-cloudfront';
import { deletePrefix, deployZipToPrefix, writeObject } from '../shared/content-ops';
import { isContentDeployerResourceProperties } from './types';

export const handler = withSmokeTest(wrapHandler(async (event: any, context: any) => {
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
      // Delete existing prefix (full overwrite)
      await deletePrefix(targetBucket, source.targetPrefix);
      const res = await deployZipToPrefix({
        sourceBucket: source.sourceBucket,
        sourceKey: source.sourceKey,
        sourceVersionId: source.sourceVersionId,
        targetBucket,
        targetPrefix: source.targetPrefix,
      });
      objectsWritten += res.uploaded;
    } else if (source.kind === 'data') {
      // Write exact key with metadata
      await writeObject({
        targetBucket,
        key: source.key,
        body: source.body,
        contentType: source.contentType,
        cacheControl: source.cacheControl,
      });
      objectsWritten += 1;
    }
  }

  const invalidationRes = await invalidateCloudFront({
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

  return {
    PhysicalResourceId: currentPhysicalId,
    Data: {
      deleted: '0',
      objectsWritten: String(objectsWritten),
      cacheInvalidated: String(cacheInvalidated),
    },
  };
}));
