/// <reference types="jest" />

/**
 * Pins the rollback both update paths share: the function's code is replaced with the deployed release and the
 * artifact version tag is never written. A rollback that Lambda rejects while settling must not throw, because
 * the caller has nothing left to do but report the verdict; it is logged at error so an operator sees that the
 * function may be left on code that failed its probe.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  GetFunctionConfigurationCommand,
  LambdaClient,
  TagResourceCommand,
  UpdateFunctionCodeCommand,
} from '@aws-sdk/client-lambda';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { SemVer } from 'semver';
import { LambdaCodeRollback } from '../lambda-code-rollback';
import { LambdaFunctionCode } from '../lambda-function-code';
import type { ArtifactLocation, StaleTarget } from '../release-artifacts';
import { ARTIFACT_BUCKET_US_EAST_1, lambdaTarget, NEWER_VERSION, noSleep } from './updater-helpers';

describe('LambdaCodeRollback', () => {
  const lambdaMock = mockClient(LambdaClient);
  const lambda = new LambdaClient({ region: 'us-east-1' });
  const target = lambdaTarget();
  const stale: StaleTarget = {
    version: NEWER_VERSION,
    parsed: new SemVer('1.2.4'),
    deployed: new SemVer('1.2.3'),
  };
  const deployedLocation: ArtifactLocation = {
    bucket: ARTIFACT_BUCKET_US_EAST_1,
    key: 'releases/v1.2.3/lambdas/mailbox-go.zip',
  };

  function newRollback(): LambdaCodeRollback {
    const logger = new LoggerBuffer();
    return new LambdaCodeRollback(new LambdaFunctionCode(noSleep), logger);
  }

  beforeEach(() => {
    lambdaMock.reset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({ LastUpdateStatus: 'Successful' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('replaces the code with the deployed release, writes no tag and logs the verdict that caused it', async () => {
    await newRollback().restore(lambda, target, stale, 'unprobeable', deployedLocation);

    const updates = lambdaMock.commandCalls(UpdateFunctionCodeCommand);
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0].input).toEqual({
      FunctionName: target.arn,
      S3Bucket: 'mailbox-artifacts-us-east-1',
      S3Key: 'releases/v1.2.3/lambdas/mailbox-go.zip',
    });
    expect(lambdaMock.commandCalls(TagResourceCommand)).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith('smoke test did not pass, rolling back', {
      lambdaArn: target.arn,
      verdict: 'unprobeable',
      failedVersion: '1.2.4',
      deployedVersion: '1.2.3',
    });
  });

  it('logs and does not throw when the rollback does not settle', async () => {
    lambdaMock
      .on(GetFunctionConfigurationCommand)
      .resolves({ LastUpdateStatus: 'Failed', LastUpdateStatusReason: 'rollback rejected' });

    await expect(newRollback().restore(lambda, target, stale, 'fail', deployedLocation)).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith('rollback settle-wait failed', {
      lambdaArn: target.arn,
      error: `Function code update failed for ${target.arn}: rollback rejected`,
      note: 'function may still be on failed code; manual intervention may be needed',
    });
  });
});
