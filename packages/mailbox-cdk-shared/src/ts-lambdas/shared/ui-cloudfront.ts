import type { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { createHash } from 'node:crypto';

export async function invalidateCloudFront(
  cloudFront: CloudFrontClient,
  params: {
    distributionId?: string;
    paths?: string[];
    callerReference: string;
  },
): Promise<{ invalidated: boolean }> {
  const { distributionId, paths, callerReference } = params;
  const dist = (distributionId ?? '').trim();
  if (!dist) return { invalidated: false };

  const items = (paths ?? []).map((p) => String(p).trim()).filter(Boolean);
  if (items.length === 0) return { invalidated: false };

  await cloudFront.send(
    new CreateInvalidationCommand({
      DistributionId: dist,
      InvalidationBatch: {
        // CloudFront CallerReference max length is 128.
        CallerReference:
          callerReference.length <= 128
            ? callerReference
            : createHash('sha256').update(callerReference).digest('hex').slice(0, 64),
        Paths: {
          Quantity: items.length,
          Items: items,
        },
      },
    }),
  );

  return { invalidated: true };
}
