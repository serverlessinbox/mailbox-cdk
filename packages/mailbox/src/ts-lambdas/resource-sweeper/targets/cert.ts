import {
  ACMClient,
  DescribeCertificateCommand,
  DeleteCertificateCommand,
  ListTagsForCertificateCommand,
} from '@aws-sdk/client-acm';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { CertRemovalInput, TargetResult } from './types';

/**
 * Sweeps the ACM certificate named by `input.certArn`.
 * DescribeCertificate → check InUseBy. If empty, DeleteCertificate.
 * ResourceNotFoundException → already done. Ownership mismatch → failed. InUseBy non-empty → retry.
 */
export async function sweepCert(input: CertRemovalInput, logger: LoggerBuffer, acmClient: ACMClient): Promise<TargetResult> {
  const { certArn } = input;

  try {

    logger.debug('Verifying ACM cert ownership');
    try {
      const tagsResp = await acmClient.send(new ListTagsForCertificateCommand({ CertificateArn: certArn }));
      const tags = tagsResp.Tags ?? [];
      const ownerTag = tags.find((t) => t.Key === 'serverless-inbox:root-stack');
      if (ownerTag?.Value !== input.rootStackName) {
        logger.warn('ACM cert ownership mismatch', {
          expectedStack: input.rootStackName,
          actualStack: ownerTag?.Value,
        });
        return {
          target: 'cert',
          status: 'failed',
          reason: `Ownership mismatch (expected ${input.rootStackName}, got ${ownerTag?.Value})`,
        };
      }

      logger.debug('ACM cert ownership verified; checking InUseBy');
      const descResp = await acmClient.send(new DescribeCertificateCommand({ CertificateArn: certArn }));
      const inUseBy = descResp.Certificate?.InUseBy ?? [];
      if (inUseBy.length > 0) {
        logger.info('ACM cert still in use; will retry', { inUseByCount: inUseBy.length });
        return { target: 'cert', status: 'retry', reason: `InUseBy: ${inUseBy.join(', ')}` };
      }

      logger.info('ACM cert not in use; attempting delete');
      await acmClient.send(new DeleteCertificateCommand({ CertificateArn: certArn }));
      logger.info('ACM cert deleted successfully');
      return { target: 'cert', status: 'done' };
    } catch (err: any) {
      if (err.name === 'ResourceNotFoundException') {
        logger.debug('ACM cert not found; treating as deleted');
        return { target: 'cert', status: 'done' };
      }
      throw err;
    }
  } catch (err: any) {
    logger.error('ACM cert deletion error', { errorName: err?.name, errorMessage: err?.message });
    return { target: 'cert', status: 'failed', reason: `${err?.name}: ${err?.message}` };
  }
}
