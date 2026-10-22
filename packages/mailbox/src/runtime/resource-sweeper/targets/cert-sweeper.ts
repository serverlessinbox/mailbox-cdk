import {
  ACMClient,
  DescribeCertificateCommand,
  DeleteCertificateCommand,
  ListTagsForCertificateCommand,
} from '@aws-sdk/client-acm';
import type { LoggerBuffer }                                     from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import { OwnershipCheckedDelete }                                from '../ownership-checked-delete';
import type { CertRemovalInput, TargetResult, TargetSweeper }    from '../removal';
import { RootStackMembership }                                   from '../root-stack-membership';
import { TargetResults }                                         from '../target-results';

/**
 * Sweeps the ACM certificate named by `CertRemovalInput.certArn`: deletes it once it belongs to
 * the root stack and nothing uses it.
 */
export class CertSweeper implements TargetSweeper<CertRemovalInput> {
  private readonly results = new TargetResults('cert');
  private readonly ownershipCheckedDelete: OwnershipCheckedDelete;

  constructor(
    private readonly acmClient: ACMClient,
    private readonly rootStackMembership: RootStackMembership,
    private readonly logger: LoggerBuffer,
  ) {
    this.ownershipCheckedDelete = new OwnershipCheckedDelete(this.results, logger);
  }

  /**
   * Deletes the certificate when it belongs to the root stack and nothing uses it. Resolves to `SUCCESS` once
   * the certificate is gone (deleted now, or already absent), `RETRY` while something still uses it,
   * and `FAILED` on a root stack mismatch or any other error. Never rejects.
   */
  public async sweep(input: CertRemovalInput): Promise<TargetResult> {
    return this.ownershipCheckedDelete.sweep({
      label:                 'ACM cert',
      goneErrorName:         'ResourceNotFoundException',
      otherErrors:           'failed',
      findRootStackMismatch: () => this.findRootStackMismatch(input),
      deleteResource:        () => this.deleteWhenUnused(input),
    });
  }

  private async findRootStackMismatch(input: CertRemovalInput): Promise<string | undefined> {
    this.logger.debug('Verifying ACM cert belongs to the root stack');
    const tagsResp = await this.acmClient.send(new ListTagsForCertificateCommand({ CertificateArn: input.certArn }));
    return this.rootStackMembership.mismatchInTagList(input, 'ACM cert', tagsResp.Tags);
  }

  private async deleteWhenUnused(input: CertRemovalInput): Promise<TargetResult> {
    const inUseBy = await this.findUsers(input);
    // A certificate that something still uses cannot be deleted yet, so the sweep is retried.
    if (inUseBy.length > 0) {
      this.logger.info('ACM cert still in use; will retry', { inUseByCount: inUseBy.length });
      return this.results.retry(`InUseBy: ${inUseBy.join(', ')}`);
    }

    await this.deleteCertificate(input);
    return this.results.done();
  }

  private async findUsers(input: CertRemovalInput): Promise<string[]> {
    this.logger.debug('ACM cert belongs to the root stack; checking InUseBy');
    const descResp = await this.acmClient.send(new DescribeCertificateCommand({ CertificateArn: input.certArn }));
    return descResp.Certificate?.InUseBy ?? [];
  }

  private async deleteCertificate(input: CertRemovalInput): Promise<void> {
    this.logger.info('ACM cert not in use; attempting delete');
    await this.acmClient.send(new DeleteCertificateCommand({ CertificateArn: input.certArn }));
    this.logger.info('ACM cert deleted successfully');
  }
}
