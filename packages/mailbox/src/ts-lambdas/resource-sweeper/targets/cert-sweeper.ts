import {
  ACMClient,
  DescribeCertificateCommand,
  DeleteCertificateCommand,
  ListTagsForCertificateCommand,
} from '@aws-sdk/client-acm';
import type { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { CaughtError } from '../caught-error';
import type { CertRemovalInput, TargetResult, TargetSweeper } from '../removal';
import { StackOwnership } from '../stack-ownership';
import { TargetResults } from '../target-results';

/**
 * Sweeps the ACM certificate named by `CertRemovalInput.certArn`: deletes it once it is owned by
 * the root stack and no longer in use. A certificate that is already gone counts as swept; one still
 * in use is retried; an ownership mismatch or any other error fails.
 */
export class CertSweeper implements TargetSweeper<CertRemovalInput> {
  private readonly results = new TargetResults('cert');

  constructor(
    private readonly acmClient: ACMClient,
    private readonly ownership: StackOwnership,
    private readonly logger: LoggerBuffer,
  ) {}

  /**
   * Deletes the certificate when the root stack owns it and nothing uses it. Resolves to `done` once
   * the certificate is gone (deleted now, or already absent), `retry` while something still uses it,
   * and `failed` on an ownership mismatch or any other error. Never rejects.
   */
  public async sweep(input: CertRemovalInput): Promise<TargetResult> {
    try {
      return await this.deleteWhenOwnedAndUnused(input);
    } catch (thrown) {
      return this.resultOfFailure(thrown);
    }
  }

  private async deleteWhenOwnedAndUnused(input: CertRemovalInput): Promise<TargetResult> {
    const mismatch = await this.findOwnershipMismatch(input);
    // Never delete what another stack owns. A mismatch is final, so it is not retried.
    if (mismatch) {
      return this.results.failed(mismatch);
    }

    const inUseBy = await this.findUsers(input);
    // A certificate that something still uses cannot be deleted yet, so the sweep is retried.
    if (inUseBy.length > 0) {
      return this.stillInUse(inUseBy);
    }

    await this.deleteCertificate(input);
    return this.results.done();
  }

  private async findOwnershipMismatch(input: CertRemovalInput): Promise<string | undefined> {
    this.logger.debug('Verifying ACM cert ownership');
    const tagsResp = await this.acmClient.send(new ListTagsForCertificateCommand({ CertificateArn: input.certArn }));
    return this.ownership.mismatchInTagList(input.rootStackName, 'ACM cert', tagsResp.Tags);
  }

  private async findUsers(input: CertRemovalInput): Promise<string[]> {
    this.logger.debug('ACM cert ownership verified; checking InUseBy');
    const descResp = await this.acmClient.send(new DescribeCertificateCommand({ CertificateArn: input.certArn }));
    return descResp.Certificate?.InUseBy ?? [];
  }

  private stillInUse(inUseBy: readonly string[]): TargetResult {
    this.logger.info('ACM cert still in use; will retry', { inUseByCount: inUseBy.length });
    return this.results.retry(`InUseBy: ${inUseBy.join(', ')}`);
  }

  private async deleteCertificate(input: CertRemovalInput): Promise<void> {
    this.logger.info('ACM cert not in use; attempting delete');
    await this.acmClient.send(new DeleteCertificateCommand({ CertificateArn: input.certArn }));
    this.logger.info('ACM cert deleted successfully');
  }

  private resultOfFailure(thrown: unknown): TargetResult {
    const error = new CaughtError(thrown);
    // A certificate that no longer exists is what the sweep is after, so it counts as swept.
    if (error.is('ResourceNotFoundException')) {
      this.logger.debug('ACM cert not found; treating as deleted');
      return this.results.done();
    }

    // Any other error is a failed sweep, reported with its name and message as the result's reason.
    this.logger.error('ACM cert deletion error', { errorName: error.name, errorMessage: error.message });
    return this.results.failed(error.describe());
  }
}
