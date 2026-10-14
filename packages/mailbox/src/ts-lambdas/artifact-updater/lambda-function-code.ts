import {
  GetFunctionConfigurationCommand,
  TagResourceCommand,
  UpdateFunctionCodeCommand,
  type LambdaClient,
} from '@aws-sdk/client-lambda';
import type { ArtifactLocation } from './release-artifacts';
import { UpdaterTagKeys } from './updater-tags';
import type { ArtifactVersion, LambdaFunctionArn } from './updater-identifiers';

const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 2000;

/** Waits for the given number of milliseconds. */
export type Sleep = (milliseconds: number) => Promise<void>;

/**
 * The operations on the code of a Lambda function that the code and edge update paths share: replace the
 * code, wait until the replacement has settled, and record the artifact version the function now runs. Each
 * takes the client of the region the function lives in.
 */
export class LambdaFunctionCode {
  private readonly sleep: Sleep;

  constructor(sleep: Sleep) {
    this.sleep = sleep;
  }

  public async update(lambda: LambdaClient, functionArn: LambdaFunctionArn, location: ArtifactLocation): Promise<void> {
    await lambda.send(
      new UpdateFunctionCodeCommand({
        FunctionName: functionArn,
        S3Bucket: location.bucket,
        S3Key: location.key,
      }),
    );
  }

  /**
   * Returns once the last code update of the function has succeeded. Throws when it failed or when it has not
   * settled within the polling limit.
   */
  public async waitUntilSettled(lambda: LambdaClient, functionArn: LambdaFunctionArn): Promise<void> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const configuration = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionArn }));

      if (configuration.LastUpdateStatus === 'Successful') {
        return;
      }
      if (configuration.LastUpdateStatus === 'Failed') {
        const reason = configuration.LastUpdateStatusReason || 'unknown reason';
        throw new Error(`Function code update failed for ${functionArn}: ${reason}`);
      }

      if (attempt < MAX_POLL_ATTEMPTS - 1) {
        await this.sleep(POLL_INTERVAL_MS);
      }
    }

    throw new Error(`Timed out waiting for function code update to settle for ${functionArn}`);
  }

  public async tagArtifactVersion(
    lambda: LambdaClient,
    functionArn: LambdaFunctionArn,
    version: ArtifactVersion,
  ): Promise<void> {
    await lambda.send(
      new TagResourceCommand({
        Resource: functionArn,
        Tags: { [UpdaterTagKeys.artifactVersion]: version },
      }),
    );
  }
}
