import type { CloudFrontClient }     from '@aws-sdk/client-cloudfront';
import { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { createHash }                from 'node:crypto';

const MAX_CALLER_REFERENCE_LENGTH    = 128;
const HASHED_CALLER_REFERENCE_LENGTH = 64;

/** What to invalidate: the distribution, the paths on it and the caller reference that makes the request idempotent. */
export interface InvalidationRequest {
  readonly distributionId?: string;
  readonly paths?:          readonly string[];
  readonly callerReference: string;
}

/** Whether an invalidation was created; false when the request named no distribution or no path. */
export interface InvalidationResult {
  readonly invalidated: boolean;
}

/**
 * Invalidates the paths on the distribution. A request without a distribution id or without any non-blank path
 * creates nothing. A caller reference longer than CloudFront accepts is replaced by its hash.
 */
export async function invalidateCloudFront(
  cloudFront: CloudFrontClient,
  request: InvalidationRequest,
): Promise<InvalidationResult> {
  const { distributionId, paths, callerReference } = request;
  const dist                                       = (distributionId ?? '').trim();
  if (!dist) {
    return { invalidated: false };
  }

  const items = (paths ?? []).map((pathEntry) => String(pathEntry).trim()).filter(Boolean);
  if (items.length === 0) {
    return { invalidated: false };
  }

  await cloudFront.send(
    new CreateInvalidationCommand({
      DistributionId:    dist,
      InvalidationBatch: {
        CallerReference:
          callerReference.length <= MAX_CALLER_REFERENCE_LENGTH
            ? callerReference
            : createHash('sha256').update(callerReference).digest('hex').slice(0, HASHED_CALLER_REFERENCE_LENGTH),
        Paths: {
          Quantity: items.length,
          Items:    items,
        },
      },
    }),
  );

  return { invalidated: true };
}
