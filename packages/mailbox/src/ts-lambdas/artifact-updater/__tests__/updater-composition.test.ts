/// <reference types="jest" />

/**
 * Pins what the composition builds from the environment: a loaded configuration gets clients (the edge set shared
 * with the deployment set only when the deployment region is the edge region), a failed one gets none and its
 * problem; and that each trigger it builds is handed the cycle, the deployment-region Lambda client, the names and
 * the configuration problem of that runtime, so a failed configuration reaches the trigger and not a client that
 * does not exist. The update cycle is faked because it reads and writes AWS.
 */

import { InvokeCommand }      from '@aws-sdk/client-lambda';
import { mockClient }         from 'aws-sdk-client-mock';
import * as https             from 'https';
import { Writable }           from 'stream';

import { UpdateCycle }        from '../update-cycle';
import { EDGE_REGION }        from '../updater-clients';
import { UpdaterComposition } from '../updater-composition';

import {
  BAD_CONFIG_ERROR,
  deployEndTriggerEvent,
  failedRuntime,
  fakeLambdaContext,
  httpApiEvent,
  readyRuntime,
} from './updater-helpers';

jest.mock('../update-cycle');
jest.mock('https', () => ({
  request: jest.fn(),
}));

const GOOD_ENVIRONMENT = {
  SERVICE_NAME: 'artifact-updater',
  AWS_REGION: 'eu-west-1',
  AWS_LAMBDA_FUNCTION_NAME: 'artifact-updater-function',
  PROJECT: 'serverlessinbox',
  DIST_TAG: 'latest',
  GRANULARITY: 'major',
  ARTIFACT_BUCKET_BASE: 'mailbox-artifacts',
  ROOT_STACK_TAG_VALUE: 'my-stack',
  ROOT_STACK_ID: 'guid-1',
};

describe('UpdaterComposition', () => {
  const originalEnv = process.env;
  let responseJson: string;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    responseJson = '';
    jest.mocked(https.request).mockImplementation(((_options: unknown, callback: (res: object) => void) => {
      callback({ statusCode: 200 });
      return new Writable({
        write(chunk: Buffer, _encoding, done) {
          responseJson += chunk.toString();
          done();
        },
      });
    }) as typeof https.request);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('loadRuntime', () => {
    it('builds the clients in the deployment region and a separate edge set when the regions differ', () => {
      process.env = { ...originalEnv, ...GOOD_ENVIRONMENT };

      const runtime = UpdaterComposition.loadRuntime();

      expect(runtime.error).toBeUndefined();
      expect(runtime.clients?.deployment.region).toBe('eu-west-1');
      expect(runtime.clients?.edge.region).toBe(EDGE_REGION);
      expect(runtime.clients?.edge).not.toBe(runtime.clients?.deployment);
    });

    it('shares the deployment set as the edge set when the deployment region is the edge region', () => {
      process.env = { ...originalEnv, ...GOOD_ENVIRONMENT, AWS_REGION: EDGE_REGION };

      const runtime = UpdaterComposition.loadRuntime();

      expect(runtime.clients?.edge).toBe(runtime.clients?.deployment);
    });

    it('reports every problem and builds no clients when the configuration is bad', () => {
      process.env = { ...originalEnv, ...GOOD_ENVIRONMENT, LOG_LEVEL: 'verbose' };

      const runtime = UpdaterComposition.loadRuntime();

      expect(runtime.clients).toBeUndefined();
      expect(runtime.error).toContain('LOG_LEVEL');
    });
  });

  describe('for a configuration that loaded', () => {
    it('builds a scheduled trigger that runs an update cycle', async () => {
      await new UpdaterComposition(readyRuntime()).scheduledTrigger().handle();

      expect(UpdateCycle).toHaveBeenCalledTimes(1);
      expect(jest.mocked(UpdateCycle.prototype.run)).toHaveBeenCalledTimes(1);
    });

    it('builds an HTTP trigger that invokes the configured function through the deployment region client', async () => {
      const runtime    = readyRuntime();
      const lambdaMock = mockClient(runtime.clients!.deployment.lambda);
      lambdaMock.on(InvokeCommand).resolves({});

      await new UpdaterComposition(runtime).httpTrigger(httpApiEvent('POST', '/artifact-updates/trigger')).handle();

      expect(lambdaMock.commandCalls(InvokeCommand)[0].args[0].input).toMatchObject({
        FunctionName: 'artifact-updater-function',
      });
    });

    it('builds a CloudFormation trigger that emits the manual-finalize hint under the service name', async () => {
      await new UpdaterComposition(readyRuntime()).cfnTrigger(deployEndTriggerEvent('Delete'), fakeLambdaContext()).handle();

      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^MANUAL_FINALIZE .* service=artifact-updater$/));
    });
  });

  describe('for a configuration that failed to load', () => {
    it('builds a scheduled trigger that throws the configuration error and builds no cycle', async () => {
      await expect(new UpdaterComposition(failedRuntime()).scheduledTrigger().handle()).rejects.toThrow(BAD_CONFIG_ERROR);

      expect(UpdateCycle).not.toHaveBeenCalled();
    });

    it('builds an HTTP trigger that answers 500 naming the problem', async () => {
      const response = await new UpdaterComposition(failedRuntime())
        .httpTrigger(httpApiEvent('POST', '/artifact-updates/trigger'))
        .handle();

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({ error: `Configuration error: ${BAD_CONFIG_ERROR}` });
    });

    it('builds a CloudFormation trigger that answers FAILED naming the problem', async () => {
      await new UpdaterComposition(failedRuntime()).cfnTrigger(deployEndTriggerEvent('Create'), fakeLambdaContext()).handle();

      expect(JSON.parse(responseJson)).toMatchObject({ Status: 'FAILED', Reason: expect.stringContaining(BAD_CONFIG_ERROR) });
    });
  });
});
