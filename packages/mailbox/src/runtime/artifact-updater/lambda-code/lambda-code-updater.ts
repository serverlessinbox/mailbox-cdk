import { CaughtError, type LoggerBuffer }                       from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { LambdaTarget }                                    from '../artifact-target';
import type { ArtifactLocation, ReleaseArtifacts, StaleTarget } from '../release-artifacts';
import type { RegionClients }                                   from '../updater-clients';

import type { FunctionSmokeTester, SmokeTestVerdict }           from './function-smoke-tester';
import type { LambdaCodeRollback }                              from './lambda-code-rollback';
import type { LambdaFunctionCode }                              from './lambda-function-code';

/**
 * Advances a Lambda function to the newer release of its code, when there is one. The new code is probed with
 * the smoke test and kept only when the probe passes, which is also the only case in which the new artifact
 * version tag is written. A function whose probe fails, or cannot be run, is put back on the code it had and
 * keeps its tag.
 */
export class LambdaCodeUpdater {
  private readonly releases: ReleaseArtifacts;
  private readonly functionCode: LambdaFunctionCode;
  private readonly smokeTester: FunctionSmokeTester;
  private readonly rollback: LambdaCodeRollback;
  private readonly logger: LoggerBuffer;

  constructor(
    releases: ReleaseArtifacts,
    functionCode: LambdaFunctionCode,
    smokeTester: FunctionSmokeTester,
    rollback: LambdaCodeRollback,
    logger: LoggerBuffer,
  ) {
    this.releases     = releases;
    this.functionCode = functionCode;
    this.smokeTester  = smokeTester;
    this.rollback     = rollback;
    this.logger       = logger;
  }

  /** True when the function runs the newer code afterwards; false when it was not behind or was rolled back. */
  public async advanceIfStale(scan: RegionClients, target: LambdaTarget): Promise<boolean> {
    const stale = await this.releases.findNewer(scan.region, target.packageName, target.deployedVersion);
    if (!stale) {
      return false;
    }

    const location = this.releases.locateLambdaCode(scan.region, target, stale.parsed);

    try {
      await this.deployNewCode(scan, target, stale, location);
      const verdict = await this.smokeTester.probe(scan.lambda, target.arn);
      return await this.settle(scan, target, stale, verdict);
    } catch (thrown) {
      this.logger.error('failed to update lambda', { lambdaArn: target.arn, error: CaughtError.readableMessage(thrown) });
      throw thrown;
    }
  }

  private async deployNewCode(
    scan: RegionClients,
    target: LambdaTarget,
    stale: StaleTarget,
    location: ArtifactLocation,
  ): Promise<void> {
    this.logger.info('updating lambda code', {
      lambdaArn:      target.arn,
      artifactBucket: location.bucket,
      artifactKey:    location.key,
      newVersion:     stale.version,
    });

    await this.functionCode.update(scan.lambda, target.arn, location);
    await this.functionCode.waitUntilSettled(scan.lambda, target.arn);
  }

  private async settle(
    scan: RegionClients,
    target: LambdaTarget,
    stale: StaleTarget,
    verdict: SmokeTestVerdict,
  ): Promise<boolean> {
    if (verdict === 'pass') {
      await this.functionCode.tagArtifactVersion(scan.lambda, target.arn, stale.version);
      this.logger.info('lambda updated', {
        lambdaArn:  target.arn,
        oldVersion: target.deployedVersion,
        newVersion: stale.version,
      });
      return true;
    }

    const deployedLocation = this.releases.locateLambdaCode(scan.region, target, stale.deployed);
    await this.rollback.restore(scan.lambda, target, stale, verdict, deployedLocation);
    return false;
  }
}
