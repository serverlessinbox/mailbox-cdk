import {
  ACMClient,
  DescribeCertificateCommand,
  DeleteCertificateCommand,
  ListTagsForCertificateCommand,
} from '@aws-sdk/client-acm';
import { CaughtError, type LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { CertRemovalInput, TargetResult, TargetSweeper } from '../removal';
import { RootStackMembership } from '../root-stack-membership';
import { TargetResults } from '../target-results';

/**
 * Sweeps the ACM certificate named by `CertRemovalInput.certArn`: deletes it once it belongs to
 * the root stack and is no longer in use.
 */
export class CertSweeper implements TargetSweeper<CertRemovalInput> {
  private readonly results = new TargetResults('cert');

  constructor(
    private readonly acmClient: ACMClient,
    private readonly rootStackMembership: RootStackMembership,
    private readonly logger: LoggerBuffer,
  ) {}

  /**
   * Deletes the certificate when it belongs to the root stack and nothing uses it. Resolves to `done` once
   * the certificate is gone (deleted now, or already absent), `retry` while something still uses it,
   * and `failed` on a root stack mismatch or any other error. Never rejects.
   */
  public async sweep(input: CertRemovalInput): Promise<TargetResult> {
    try {
      return await this.deleteWhenInRootStackAndUnused(input);
    } catch (thrown) {
      return this.resultOfFailure(thrown);
    }
  }

  private async deleteWhenInRootStackAndUnused(input: CertRemovalInput): Promise<TargetResult> {
    const mismatch = await this.findRootStackMismatch(input);
    // Never delete what belongs to another stack. A mismatch is final, so it is not retried.
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

  private async findRootStackMismatch(input: CertRemovalInput): Promise<string | undefined> {
    this.logger.debug('Verifying ACM cert belongs to the root stack');
    const tagsResp = await this.acmClient.send(new ListTagsForCertificateCommand({ CertificateArn: input.certArn }));
    return this.rootStackMembership.mismatchInTagList(input, 'ACM cert', tagsResp.Tags);
  }

  private async findUsers(input: CertRemovalInput): Promise<string[]> {
    this.logger.debug('ACM cert belongs to the root stack; checking InUseBy');
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
