/// <reference types="jest" />

/**
 * Unit tests for artifact updater common helpers, particularly waitForFunctionCodeUpdateSettled.
 *
 * Tests the polling logic by mocking the LambdaClient via aws-sdk-client-mock.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  LambdaClient,
  GetFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda';
import { waitForFunctionCodeUpdateSettled } from '../common';

describe('waitForFunctionCodeUpdateSettled', () => {
  const lambdaMock = mockClient(LambdaClient);

  beforeEach(() => {
    jest.clearAllMocks();
    lambdaMock.reset();
  });

  it('settles on first Successful status', async () => {
    const functionArn = 'arn:aws:lambda:us-east-1:123456789012:function:test';

    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Successful',
      FunctionArn: functionArn,
    });

    const client = new LambdaClient({ region: 'us-east-1' });
    await expect(waitForFunctionCodeUpdateSettled(client, functionArn)).resolves.toBeUndefined();

    // Should have called GetFunctionConfiguration exactly once
    const calls = lambdaMock.commandCalls(GetFunctionConfigurationCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.FunctionName).toBe(functionArn);
  });

  it('retries through InProgress statuses then succeeds', async () => {
    const functionArn = 'arn:aws:lambda:us-east-1:123456789012:function:test';

    lambdaMock
      .on(GetFunctionConfigurationCommand)
      .resolvesOnce({
        LastUpdateStatus: 'InProgress',
        FunctionArn: functionArn,
      })
      .resolvesOnce({
        LastUpdateStatus: 'InProgress',
        FunctionArn: functionArn,
      })
      .resolvesOnce({
        LastUpdateStatus: 'Successful',
        FunctionArn: functionArn,
      });

    const client = new LambdaClient({ region: 'us-east-1' });
    await expect(waitForFunctionCodeUpdateSettled(client, functionArn)).resolves.toBeUndefined();

    // Should have retried and eventually succeeded
    const calls = lambdaMock.commandCalls(GetFunctionConfigurationCommand);
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('throws on Failed status with reason message', async () => {
    const functionArn = 'arn:aws:lambda:us-east-1:123456789012:function:test';
    const failureReason = 'Insufficient IAM permissions to write to code signing config';

    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Failed',
      LastUpdateStatusReason: failureReason,
      FunctionArn: functionArn,
    });

    const client = new LambdaClient({ region: 'us-east-1' });
    await expect(waitForFunctionCodeUpdateSettled(client, functionArn)).rejects.toThrow(
      `Function code update failed for ${functionArn}: ${failureReason}`,
    );
  });

  it('throws on Failed status with fallback reason when none provided', async () => {
    const functionArn = 'arn:aws:lambda:us-east-1:123456789012:function:test';

    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'Failed',
      LastUpdateStatusReason: undefined,
      FunctionArn: functionArn,
    });

    const client = new LambdaClient({ region: 'us-east-1' });
    await expect(waitForFunctionCodeUpdateSettled(client, functionArn)).rejects.toThrow(
      `Function code update failed for ${functionArn}: unknown reason`,
    );
  });

  it('throws on exhausting attempts (timeout)', async () => {
    const functionArn = 'arn:aws:lambda:us-east-1:123456789012:function:test';

    // Always return InProgress to force timeout
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus: 'InProgress',
      FunctionArn: functionArn,
    });

    // Mock sleep function that doesn't actually sleep
    const mockSleep = jest.fn(async () => {});

    const client = new LambdaClient({ region: 'us-east-1' });
    await expect(waitForFunctionCodeUpdateSettled(client, functionArn, mockSleep)).rejects.toThrow(
      `Timed out waiting for function code update to settle for ${functionArn}`,
    );

    // Should have exhausted attempts (30 polls)
    const calls = lambdaMock.commandCalls(GetFunctionConfigurationCommand);
    expect(calls.length).toBe(30);

    // Mock sleep should have been called 29 times (not after the final 30th attempt)
    expect(mockSleep).toHaveBeenCalledTimes(29);
    expect(mockSleep).toHaveBeenCalledWith(2000);
  });

});
