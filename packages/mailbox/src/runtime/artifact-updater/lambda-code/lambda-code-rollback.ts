import type { LambdaClient }                  from '@aws-sdk/client-lambda';
import { CaughtError, type LoggerBuffer }     from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';

import type { LambdaTarget }                  from '../artifact-target';
import type { SmokeTestVerdict }              from './function-smoke-tester';
import type { LambdaFunctionCode }            from './lambda-function-code';
import type { ArtifactLocation, StaleTarget } from '../release-artifacts';

/**
 * Puts a Lambda function back on the code it was deployed with after new code did not pass the smoke test.
 * It never writes the artifact version tag, so the tag and the code stay in agreement.
 */
export class LambdaCodeRollback {
  private readonly functionCode: LambdaFunctionCode;
  private readonly logger: LoggerBuffer;

  constructor(functionCode: LambdaFunctionCode, logger: LoggerBuffer) {
    this.functionCode = functionCode;
    this.logger       = logger;
  }

  /**
   * Replaces the code with the deployed release at `deployedLocation`. A rollback that does not settle is
   * logged at error and thrown, so the update that needed the rollback counts as failed.
   */
  public async restore(
    lambda: LambdaClient,
    target: LambdaTarget,
    stale: StaleTarget,
    verdict: SmokeTestVerdict,
    deployedLocation: ArtifactLocation,
  ): Promise<void> {
    this.logger.error('smoke test did not pass, rolling back', {
      lambdaArn: target.arn,
      verdict,
      failedVersion:   stale.version,
      deployedVersion: target.deployedVersion,
    });

    this.logger.info('rolling back lambda to deployed version', {
      lambdaArn:         target.arn,
      oldArtifactBucket: deployedLocation.bucket,
      oldArtifactKey:    deployedLocation.key,
      version:           target.deployedVersion,
    });

    await this.functionCode.update(lambda, target.arn, deployedLocation);
    await this.waitForRollbackToSettle(lambda, target);
  }

  private async waitForRollbackToSettle(lambda: LambdaClient, target: LambdaTarget): Promise<void> {
    try {
      await this.functionCode.waitUntilSettled(lambda, target.arn);
      this.logger.info('rollback settled successfully', { lambdaArn: target.arn, version: target.deployedVersion });
    } catch (thrown) {
      this.logger.error('rollback settle-wait failed', {
        lambdaArn: target.arn,
        error:     new CaughtError(thrown).message,
        note:      'function may still be on failed code; manual intervention may be needed',
      });
      throw thrown;
    }
  }
}
