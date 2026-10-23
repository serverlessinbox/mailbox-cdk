/// <reference types="jest" />

/**
 * Pins what the composition builds from the environment: a loaded configuration gets clients (the edge set shared
 * with the deployment set only when the deployment region is the edge region), a failed one gets none and its
 * problem; and that each trigger it builds is handed the cycle, the deployment-region Lambda client, the names and
 * the configuration problem of that runtime, so a failed configuration reaches the trigger and not a client that
 * does not exist. The update cycle is faked because it reads and writes AWS. The answers the triggers give are pinned
 * by their own suites.
 */

import { InvokeCommand }      from '@aws-sdk/client-lambda';
import { mockClient }         from 'aws-sdk-client-mock';

import { UpdateCycle }        from '../update-cycle';
import { EDGE_REGION }        from '../updater-clients';
import { UpdaterComposition } from '../updater-composition';

import {
  BAD_CONFIG_ERROR,
  captureCloudFormationResponse,
  deployEndTriggerEvent,
  failedRuntime,
  fakeLambdaContext,
  GOOD_ENVIRONMENT,
  httpApiEvent,
  readyRuntime,
} from './updater-helpers';

jest.mock('../update-cycle');
jest.mock('https', () => ({
  request: jest.fn(),
}));

describe('UpdaterComposition', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    captureCloudFormationResponse();
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
      expect(runtime.clients?.edge === runtime.clients?.deployment).toBe(false);
    });

    it('shares the deployment set as the edge set when the deployment region is the edge region', () => {
      process.env = { ...originalEnv, ...GOOD_ENVIRONMENT, AWS_REGION: EDGE_REGION };

      const runtime = UpdaterComposition.loadRuntime();

      expect(runtime.clients?.edge === runtime.clients?.deployment).toBe(true);
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
      const composition = new UpdaterComposition(readyRuntime());

      await composition.scheduledTrigger().handle();

      expect(UpdateCycle).toHaveBeenCalledTimes(1);
      expect(jest.mocked(UpdateCycle.prototype.run)).toHaveBeenCalledTimes(1);
    });

    it('builds an HTTP trigger that invokes the configured function through the deployment region client', async () => {
      const runtime     = readyRuntime();
      const composition = new UpdaterComposition(runtime);
      const lambdaMock  = mockClient(runtime.clients.deployment.lambda);
      lambdaMock.on(InvokeCommand).resolves({});

      await composition.httpTrigger(httpApiEvent('POST', '/artifact-updates/trigger')).handle();

      expect(lambdaMock.commandCalls(InvokeCommand)[0].args[0].input).toMatchObject({
        FunctionName: 'artifact-updater-function',
      });
    });

    it('builds a CloudFormation trigger that emits the manual-finalize hint under the service name', async () => {
      const composition = new UpdaterComposition(readyRuntime());

      await composition.cfnTrigger(deployEndTriggerEvent('Delete'), fakeLambdaContext()).handle();

      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^MANUAL_FINALIZE .* service=artifact-updater$/));
    });
  });

  describe('for a configuration that failed to load', () => {
    it('hands the configuration problem to the triggers it builds, so a scheduled run throws it and runs no cycle', async () => {
      const composition = new UpdaterComposition(failedRuntime());

      await expect(composition.scheduledTrigger().handle()).rejects.toThrow(BAD_CONFIG_ERROR);

      expect(UpdateCycle).not.toHaveBeenCalled();
    });
  });
});
