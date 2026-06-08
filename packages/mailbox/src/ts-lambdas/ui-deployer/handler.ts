import { wrapHandler } from 'aws-custom-resources';

import { invalidateCloudFront } from './cloudfront';
import { normalizePrefix } from './paths';
import { deletePrefix, deployZipToPrefix, writeConfigJson } from './s3-ops';
import type { UiDeployerResourceProperties } from './types';

function isUiDeployerResourceProperties(
  v: unknown
): v is UiDeployerResourceProperties {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).targetBucket === 'string'
  );
}

export const handler = wrapHandler(async (event, context) => {
  const resourceProps = event.ResourceProperties ?? {};
  if (!isUiDeployerResourceProperties(resourceProps)) {
    throw new Error(
      'Invalid ResourceProperties: missing or invalid targetBucket'
    );
  }
  const props = resourceProps;

  const targetBucket = String(props.targetBucket ?? '').trim();
  if (!targetBucket) throw new Error('Missing required property: targetBucket');

  const physicalResourceId =
    event.RequestType === 'Update' || event.RequestType === 'Delete'
      ? event.PhysicalResourceId
      : `ui-assets:${event.StackId}:${event.LogicalResourceId}`;

  if (event.RequestType === 'Delete') {
    const clearAllOnDelete = Boolean(props.clearAllOnDelete);

    // Default: only clear what we manage.
    // Opt-in to full bucket wipe for dedicated buckets (helps stack deletion).
    const deleted = clearAllOnDelete
      ? await deletePrefix(targetBucket, '')
      : (await deletePrefix(targetBucket, normalizePrefix(props.contentPrefix ?? 'content/', 'content/')))
      + (await deletePrefix(targetBucket, normalizePrefix(props.configPrefix ?? 'config/', 'config/')));

    return {
      PhysicalResourceId: physicalResourceId,
      Data: {
        deleted: String(deleted),
        contentDeleted: '',
        contentUploaded: '',
        configWritten: '',
        cacheInvalidated: '',
      },
    };
  }

  const normalizedContentPrefix = normalizePrefix(props.contentPrefix ?? 'content/', 'content/');
  const normalizedConfigPrefix = normalizePrefix(props.configPrefix ?? 'config/', 'config/');

  const sourceBucket = props.sourceBucket ? String(props.sourceBucket) : undefined;
  const sourceKey = props.sourceKey ? String(props.sourceKey) : undefined;
  const sourceVersionId = props.sourceVersionId ? String(props.sourceVersionId) : undefined;

  const configJson = props.configJson ? String(props.configJson) : undefined;
  const distributionId = props.distributionId ? String(props.distributionId) : undefined;
  const invalidationPaths = Array.isArray(props.invalidationPaths) ? props.invalidationPaths : undefined;

  let contentDeleted = 0;
  let contentUploaded = 0;

  if (sourceBucket && sourceKey) {
    // Full overwrite of /content
    contentDeleted = await deletePrefix(targetBucket, normalizedContentPrefix);
    const res = await deployZipToPrefix({
      sourceBucket,
      sourceKey,
      sourceVersionId,
      targetBucket,
      targetPrefix: normalizedContentPrefix,
    });
    contentUploaded = res.uploaded;
  }

  const configRes = await writeConfigJson({
    targetBucket,
    configPrefix: normalizedConfigPrefix,
    configJson,
  });

  const invalidationRes = await invalidateCloudFront({
    distributionId,
    paths: invalidationPaths,
    callerReference: JSON.stringify({
      pr: physicalResourceId,
      n: props.deploymentNonce ?? null,
      r: event.RequestId,
      lg: context?.logGroupName ?? null,
    }),
  });

  return {
    PhysicalResourceId: physicalResourceId,
    Data: {
      deleted: '',
      contentDeleted: String(contentDeleted),
      contentUploaded: String(contentUploaded),
      configWritten: String(configRes.written),
      cacheInvalidated: String(invalidationRes.invalidated),
    },
  };
});
