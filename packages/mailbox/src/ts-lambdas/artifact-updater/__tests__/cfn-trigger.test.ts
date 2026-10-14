/// <reference types="jest" />

/**
 * Pins how the deploy-end trigger answers CloudFormation: Create and Update run the update cycle and answer
 * with the logical id as physical id, Delete answers without running it so CloudFormation keeps the physical id
 * it has, a bad configuration is answered FAILED except to a Delete, and a failed cycle still answers SUCCESS so
 * the stack's deployment goes on while the failure is thrown afterwards for the handler to flush the trace.
 * The update cycle is faked because it reads and writes AWS; the response is read from the request sent to the
 * ResponseURL.
 */

import { Writable } from 'stream';
import * as https from 'https';
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import { CfnTrigger } from '../cfn-trigger';
import { UpdateCycle } from '../update-cycle';
import {
  BAD_CONFIG_ERROR,
  badConfigCycle,
  deployEndTriggerEvent,
  fakeLambdaContext,
  newUpdateCycle,
} from './updater-helpers';

jest.mock('../update-cycle');
jest.mock('https', () => ({
  request: jest.fn(),
}));

interface CfnResponseBody {
  Status: string;
  Reason?: string;
  PhysicalResourceId?: string;
}

describe('CfnTrigger', () => {
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
    jest.restoreAllMocks();
  });

  function sentResponse(): CfnResponseBody {
    return JSON.parse(responseJson);
  }

  const cycleRuns = () => jest.mocked(UpdateCycle.prototype.run);

  function healthyTrigger(event: CloudFormationCustomResourceEvent): CfnTrigger {
    return new CfnTrigger(event, fakeLambdaContext(), newUpdateCycle, undefined, 'artifact-updater');
  }

  function misconfiguredTrigger(event: CloudFormationCustomResourceEvent): CfnTrigger {
    return new CfnTrigger(event, fakeLambdaContext(), badConfigCycle, BAD_CONFIG_ERROR, 'artifact-updater');
  }

  it('does not run the update cycle on Delete, and answers SUCCESS with the physical id CloudFormation sent', async () => {
    await healthyTrigger(deployEndTriggerEvent('Delete')).handle();

    expect(cycleRuns()).not.toHaveBeenCalled();
    expect(sentResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: 'deploy-end-physical-id' });
  });

  it.each(['Create', 'Update'] as const)('runs the update cycle on %s and answers with the logical id as physical id', async (requestType) => {
    const event = deployEndTriggerEvent(requestType);

    await healthyTrigger(event).handle();

    expect(cycleRuns()).toHaveBeenCalledTimes(1);
    expect(sentResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: event.LogicalResourceId });
  });

  it('answers SUCCESS when the update cycle fails, then throws what the cycle threw', async () => {
    const event = deployEndTriggerEvent('Create');
    cycleRuns().mockRejectedValueOnce(new Error('tagging unavailable'));

    await expect(healthyTrigger(event).handle()).rejects.toThrow('tagging unavailable');

    expect(sentResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: event.LogicalResourceId });
  });

  it('emits the manual-finalize hint under the configured service name', async () => {
    await healthyTrigger(deployEndTriggerEvent('Delete')).handle();

    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^MANUAL_FINALIZE .* service=artifact-updater$/));
  });

  describe('when the configuration failed to load', () => {
    it('answers FAILED naming the problem on Create, without running the update cycle', async () => {
      await misconfiguredTrigger(deployEndTriggerEvent('Create')).handle();

      expect(sentResponse()).toMatchObject({ Status: 'FAILED', Reason: expect.stringContaining(BAD_CONFIG_ERROR) });
      expect(cycleRuns()).not.toHaveBeenCalled();
    });

    it('answers SUCCESS on Delete with the physical id CloudFormation sent, and logs the problem', async () => {
      await misconfiguredTrigger(deployEndTriggerEvent('Delete')).handle();

      expect(sentResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: 'deploy-end-physical-id' });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Configuration error on Delete'), {
        error: BAD_CONFIG_ERROR,
      });
    });
  });
});
