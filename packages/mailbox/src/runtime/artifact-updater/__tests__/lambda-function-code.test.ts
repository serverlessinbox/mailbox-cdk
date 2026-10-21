/// <reference types="jest" />

/**
 * Pins the operations on a function's code that the code and edge update paths share. Waiting for an update
 * to settle must stop at success, fail loudly on a failed or never-settling update, and sleep between polls
 * but not after the last one, or an update that never settles holds the Lambda longer than its timeout.
 */

import {
  GetFunctionConfigurationCommand,
  LambdaClient,
  TagResourceCommand,
  UpdateFunctionCodeCommand,
} from '@aws-sdk/client-lambda';
import { mockClient }                                             from 'aws-sdk-client-mock';

import { LambdaFunctionCode }                                     from '../lambda-function-code';

import { ARTIFACT_BUCKET_US_EAST_1, lambdaTarget, NEWER_VERSION } from './updater-helpers';

describe('LambdaFunctionCode', () => {
  const lambdaMock   = mockClient(LambdaClient);
  const lambda       = new LambdaClient({ region: 'us-east-1' });
  const functionArn  = lambdaTarget().arn;
  const sleep        = jest.fn(async () => undefined);
  const functionCode = new LambdaFunctionCode(sleep);

  beforeEach(() => {
    jest.clearAllMocks();
    lambdaMock.reset();
  });

  describe('update', () => {
    it('replaces the code with the object at the location', async () => {
      lambdaMock.on(UpdateFunctionCodeCommand).resolves({});

      await functionCode.update(lambda, functionArn, {
        bucket: ARTIFACT_BUCKET_US_EAST_1,
        key: 'releases/v1.2.4/lambdas/mailbox-go.zip',
      });

      expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)[0].args[0].input).toEqual({
        FunctionName: functionArn,
        S3Bucket: 'mailbox-artifacts-us-east-1',
        S3Key: 'releases/v1.2.4/lambdas/mailbox-go.zip',
      });
    });
  });

  describe('waitUntilSettled', () => {
    it('returns on the first Successful status without sleeping', async () => {
      lambdaMock.on(GetFunctionConfigurationCommand).resolves({ LastUpdateStatus: 'Successful' });

      await expect(functionCode.waitUntilSettled(lambda, functionArn)).resolves.toBeUndefined();

      const calls = lambdaMock.commandCalls(GetFunctionConfigurationCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input.FunctionName).toBe(functionArn);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('polls through InProgress statuses, sleeping between polls, until Successful', async () => {
      lambdaMock
        .on(GetFunctionConfigurationCommand)
        .resolvesOnce({ LastUpdateStatus: 'InProgress' })
        .resolvesOnce({ LastUpdateStatus: 'InProgress' })
        .resolvesOnce({ LastUpdateStatus: 'Successful' });

      await functionCode.waitUntilSettled(lambda, functionArn);

      expect(lambdaMock.commandCalls(GetFunctionConfigurationCommand)).toHaveLength(3);
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(2000);
    });

    it('throws with the reason AWS gives when the update failed', async () => {
      lambdaMock.on(GetFunctionConfigurationCommand).resolves({
        LastUpdateStatus: 'Failed',
        LastUpdateStatusReason: 'Insufficient IAM permissions to write to code signing config',
      });

      await expect(functionCode.waitUntilSettled(lambda, functionArn)).rejects.toThrow(
        `Function code update failed for ${functionArn}: Insufficient IAM permissions to write to code signing config`,
      );
    });

    it('throws with a fallback reason when AWS gives none', async () => {
      lambdaMock.on(GetFunctionConfigurationCommand).resolves({ LastUpdateStatus: 'Failed' });

      await expect(functionCode.waitUntilSettled(lambda, functionArn)).rejects.toThrow(
        `Function code update failed for ${functionArn}: unknown reason`,
      );
    });

    it('gives up after 30 polls, sleeping after every poll but the last', async () => {
      lambdaMock.on(GetFunctionConfigurationCommand).resolves({ LastUpdateStatus: 'InProgress' });

      await expect(functionCode.waitUntilSettled(lambda, functionArn)).rejects.toThrow(
        `Timed out waiting for function code update to settle for ${functionArn}`,
      );

      expect(lambdaMock.commandCalls(GetFunctionConfigurationCommand)).toHaveLength(30);
      expect(sleep).toHaveBeenCalledTimes(29);
    });
  });

  describe('tagArtifactVersion', () => {
    it('tags the function with the artifact version it now runs', async () => {
      lambdaMock.on(TagResourceCommand).resolves({});

      await functionCode.tagArtifactVersion(lambda, functionArn, NEWER_VERSION);

      expect(lambdaMock.commandCalls(TagResourceCommand)[0].args[0].input).toEqual({
        Resource: functionArn,
        Tags: { 'serverless-inbox:artifact-version': '1.2.4' },
      });
    });
  });
});
