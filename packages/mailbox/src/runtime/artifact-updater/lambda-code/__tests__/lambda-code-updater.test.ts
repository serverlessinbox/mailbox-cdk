/// <reference types="jest" />

/**
 * Pins what the code update path does with a function: it keeps new code, and tags the function, only when the
 * smoke test passes; it puts the function back on its old code when the probe fails or cannot be run, and then
 * writes no tag, because a tag newer than the code would stop the function from ever being updated again. AWS
 * is faked at the SDK clients; the release pointer read is faked because it reads S3, and the key and track
 * builders run for real.
 */

import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  TagResourceCommand,
  UpdateFunctionCodeCommand,
} from '@aws-sdk/client-lambda';
import { LoggerBuffer, ServerlessInboxTagKeys } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                           from 'aws-sdk-client-mock';

import {
  EU_WEST_1,
  fakeUpdaterClients,
  invokeResponse,
  lambdaTarget,
  noSleep,
  testConfig,
  registryMocks,
} from '../../__tests__/updater-helpers';
import { ReleaseArtifacts }    from '../../release-artifacts';
import { FunctionSmokeTester } from '../function-smoke-tester';
import { LambdaCodeRollback }  from '../lambda-code-rollback';
import { LambdaCodeUpdater }   from '../lambda-code-updater';
import { LambdaFunctionCode }  from '../lambda-function-code';

jest.mock('@serverlessinbox/artifact-registry', () =>
  (jest.requireActual('../../__tests__/updater-helpers') as typeof import('../../__tests__/updater-helpers')).artifactRegistryModuleMock(),
);

const { readReleasePointer } = registryMocks();

describe('LambdaCodeUpdater', () => {
  const lambdaMock = mockClient(LambdaClient);
  const clients    = fakeUpdaterClients();

  function newUpdater(): LambdaCodeUpdater {
    const logger       = new LoggerBuffer();
    const functionCode = new LambdaFunctionCode(noSleep);
    return new LambdaCodeUpdater(
      new ReleaseArtifacts(clients.registryS3, testConfig, logger),
      functionCode,
      new FunctionSmokeTester(logger),
      new LambdaCodeRollback(functionCode, logger),
      logger,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    lambdaMock.reset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({ LastUpdateStatus: 'Successful' });
    lambdaMock.on(TagResourceCommand).resolves({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing and reports false when the function is not behind', async () => {
    readReleasePointer.mockResolvedValue(null);

    const updated = await newUpdater().advanceIfStale(clients.deployment, lambdaTarget());

    expect(updated).toBe(false);
    expect(lambdaMock.calls()).toHaveLength(0);
  });

  it('replaces the code with the newer release and tags the function when the smoke test passes', async () => {
    readReleasePointer.mockResolvedValue({ version: '1.2.4' });
    lambdaMock.on(InvokeCommand).resolves(invokeResponse('{"serverlessInboxSmokeTestOk":true}'));

    const updated = await newUpdater().advanceIfStale(clients.deployment, lambdaTarget());

    expect(updated).toBe(true);
    const updates = lambdaMock.commandCalls(UpdateFunctionCodeCommand);
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0].input).toEqual({
      FunctionName: lambdaTarget().arn,
      S3Bucket:     'mailbox-artifacts-us-east-1',
      S3Key:        'serverlessinbox/packages/mailbox-go/releases/v1.2.4/lambdas/mailbox-go.zip',
    });
    const tags = lambdaMock.commandCalls(TagResourceCommand);
    expect(tags).toHaveLength(1);
    expect(tags[0].args[0].input.Tags).toEqual({ [ServerlessInboxTagKeys.artifactVersion]: '1.2.4' });
  });

  it('works through the Lambda client of the region it is given', async () => {
    const euClients = fakeUpdaterClients(EU_WEST_1);
    readReleasePointer.mockResolvedValue({ version: '1.2.4' });
    lambdaMock.on(InvokeCommand).resolves(invokeResponse('{"serverlessInboxSmokeTestOk":true}'));

    await newUpdater().advanceIfStale(
      euClients.deployment,
      lambdaTarget({ arn: 'arn:aws:lambda:eu-west-1:123456789012:function:mailbox-go' }),
    );

    const callsOnGivenClient = lambdaMock.calls().filter((call) => call.thisValue === euClients.deployment.lambda);
    expect(callsOnGivenClient).toHaveLength(lambdaMock.calls().length);
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)[0].args[0].input.S3Bucket).toBe(
      'mailbox-artifacts-eu-west-1',
    );
  });

  describe.each([
    {
      outcome:      'fails',
      arrangeProbe: () => lambdaMock.on(InvokeCommand).resolves(invokeResponse('{"serverlessInboxSmokeTestOk":false}')),
    },
    {
      outcome:      'cannot be run',
      arrangeProbe: () => lambdaMock.on(InvokeCommand).rejects(new Error('AccessDenied')),
    },
  ])('when the smoke test $outcome', ({ arrangeProbe }) => {
    it('puts the function back on its old code and writes no tag', async () => {
      readReleasePointer.mockResolvedValue({ version: '1.2.4' });
      arrangeProbe();

      const updated = await newUpdater().advanceIfStale(clients.deployment, lambdaTarget());

      expect(updated).toBe(false);
      const updates = lambdaMock.commandCalls(UpdateFunctionCodeCommand);
      expect(updates.map((call) => call.args[0].input.S3Key)).toEqual([
        'serverlessinbox/packages/mailbox-go/releases/v1.2.4/lambdas/mailbox-go.zip',
        'serverlessinbox/packages/mailbox-go/releases/v1.2.3/lambdas/mailbox-go.zip',
      ]);
      expect(lambdaMock.commandCalls(TagResourceCommand)).toHaveLength(0);
    });
  });

  it('throws and logs, without rolling back, when tagging the passed function fails', async () => {
    readReleasePointer.mockResolvedValue({ version: '1.2.4' });
    lambdaMock.on(InvokeCommand).resolves(invokeResponse('{"serverlessInboxSmokeTestOk":true}'));
    lambdaMock.on(TagResourceCommand).rejects(new Error('TagResource throttled'));

    await expect(newUpdater().advanceIfStale(clients.deployment, lambdaTarget())).rejects.toThrow('TagResource throttled');

    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith('failed to update lambda', {
      lambdaArn: lambdaTarget().arn,
      error:     'TagResource throttled',
    });
  });

  it('throws and logs, without probing or rolling back, when the new code does not settle', async () => {
    readReleasePointer.mockResolvedValue({ version: '1.2.4' });
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({
      LastUpdateStatus:       'Failed',
      LastUpdateStatusReason: 'Insufficient permissions',
    });

    await expect(newUpdater().advanceIfStale(clients.deployment, lambdaTarget())).rejects.toThrow(
      'Function code update failed',
    );

    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(1);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(TagResourceCommand)).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith('failed to update lambda', {
      lambdaArn: lambdaTarget().arn,
      error:     `Function code update failed for ${lambdaTarget().arn}: Insufficient permissions`,
    });
  });
});
