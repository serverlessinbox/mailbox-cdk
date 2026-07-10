import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { createHash } from 'node:crypto';

const requestHandler = new NodeHttpHandler({
  requestTimeout: 5000,
  connectionTimeout: 5000,
});

const cloudFront = new CloudFrontClient({ requestHandler });

export async function invalidateCloudFront(params: {
  distributionId?: string;
  paths?: string[];
  callerReference: string;
}): Promise<{ invalidated: boolean }> {
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
