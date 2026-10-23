/// <reference types="jest" />

/**
 * Pins how the deploy-end trigger answers CloudFormation: Create and Update run the update cycle and answer
 * with the logical id as physical id, Delete answers without running it so CloudFormation keeps the physical id
 * it has, a bad configuration is answered FAILED except to a Delete and to an Update while the parent stack
 * rolls back (answering FAILED there strands the stack in UPDATE_ROLLBACK_FAILED), and a failed cycle still
 * answers SUCCESS so the stack's deployment goes on while the failure is thrown afterwards for the handler to
 * flush the trace. The update cycle is faked because it reads and writes AWS, and so is the stack status the
 * CloudFormation client returns; the response is read from the request sent to the ResponseURL.
 */

import { CloudFormationClient, DescribeStacksCommand, type StackStatus } from '@aws-sdk/client-cloudformation';
import { ParentStackStatus }                                             from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { captureCfnResponse, type CapturedCfnResponse }                  from '@serverlessinbox/mailbox-cdk-shared/runtime-test-support';
import type { CloudFormationCustomResourceEvent }                        from 'aws-lambda';
import { mockClient }                                                    from 'aws-sdk-client-mock';

import {
  BAD_CONFIG_ERROR,
  badConfigCycle,
  deployEndTriggerEvent,
  fakeCloudFormationClient,
  fakeLambdaContext,
  newUpdateCycle,
} from '../../__tests__/updater-helpers';
import { UpdateCycle }                                                   from '../../update-cycle';
import { CfnTrigger }                                                    from '../cfn-trigger';

jest.mock('../../update-cycle');
jest.mock('https', () => ({
  request: jest.fn(),
}));

describe('CfnTrigger', () => {
  const cloudFormationMock       = mockClient(CloudFormationClient);
  const badConfigReason: unknown = expect.stringContaining(BAD_CONFIG_ERROR);
  let cfnResponse: () => CapturedCfnResponse;

  beforeEach(() => {
    jest.clearAllMocks();
    cloudFormationMock.reset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    cfnResponse = captureCfnResponse();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const cycleRuns = () => jest.mocked(UpdateCycle.prototype.run);

  function healthyTrigger(event: CloudFormationCustomResourceEvent): CfnTrigger {
    return new CfnTrigger(event, fakeLambdaContext(), newUpdateCycle, new ParentStackStatus(fakeCloudFormationClient()), undefined, 'artifact-updater');
  }

  function misconfiguredTrigger(event: CloudFormationCustomResourceEvent): CfnTrigger {
    return new CfnTrigger(
      event,
      fakeLambdaContext(),
      badConfigCycle,
      new ParentStackStatus(fakeCloudFormationClient()),
      BAD_CONFIG_ERROR,
      'artifact-updater',
    );
  }

  function parentStackStatus(status: StackStatus): void {
    cloudFormationMock.on(DescribeStacksCommand).resolves({ Stacks: [{ StackName: 'my-stack', CreationTime: new Date(0), StackStatus: status }] });
  }

  it('does not run the update cycle on Delete, and answers SUCCESS with the physical id CloudFormation sent', async () => {
    await healthyTrigger(deployEndTriggerEvent('Delete')).handle();

    expect(cycleRuns()).not.toHaveBeenCalled();
    expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: 'deploy-end-physical-id' });
  });

  it.each(['Create', 'Update'] as const)('runs the update cycle on %s and answers with the logical id as physical id', async (requestType) => {
    const event = deployEndTriggerEvent(requestType);

    await healthyTrigger(event).handle();

    expect(cycleRuns()).toHaveBeenCalledTimes(1);
    expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: event.LogicalResourceId });
  });

  it('answers SUCCESS when the update cycle fails, then throws what the cycle threw', async () => {
    const event = deployEndTriggerEvent('Create');
    cycleRuns().mockRejectedValueOnce(new Error('tagging unavailable'));

    await expect(healthyTrigger(event).handle()).rejects.toThrow('tagging unavailable');

    expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: event.LogicalResourceId });
  });

  it('emits the manual-finalize hint under the configured service name', async () => {
    await healthyTrigger(deployEndTriggerEvent('Delete')).handle();

    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^MANUAL_FINALIZE .* service=artifact-updater$/));
  });

  describe('when the configuration failed to load', () => {
    it('answers FAILED naming the problem on Create, without running the update cycle', async () => {
      await misconfiguredTrigger(deployEndTriggerEvent('Create')).handle();

      expect(cfnResponse()).toMatchObject({ Status: 'FAILED', Reason: badConfigReason });
      expect(cycleRuns()).not.toHaveBeenCalled();
    });

    it('answers SUCCESS on an Update while the parent stack rolls back, with the physical id CloudFormation sent', async () => {
      const event = deployEndTriggerEvent('Update');
      parentStackStatus('UPDATE_ROLLBACK_IN_PROGRESS');

      await misconfiguredTrigger(event).handle();

      expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: 'deploy-end-physical-id' });
      expect(cloudFormationMock.commandCalls(DescribeStacksCommand)[0].args[0].input).toEqual({ StackName: event.StackId });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Configuration error on Update'), {
        error: BAD_CONFIG_ERROR,
      });
    });

    it('answers FAILED on an Update when the parent stack is not rolling back', async () => {
      parentStackStatus('UPDATE_IN_PROGRESS');

      await misconfiguredTrigger(deployEndTriggerEvent('Update')).handle();

      expect(cfnResponse()).toMatchObject({ Status: 'FAILED', Reason: badConfigReason });
    });

    it('answers FAILED on a Create even while the parent stack rolls back, without reading its status', async () => {
      parentStackStatus('UPDATE_ROLLBACK_IN_PROGRESS');

      await misconfiguredTrigger(deployEndTriggerEvent('Create')).handle();

      expect(cfnResponse()).toMatchObject({ Status: 'FAILED', Reason: badConfigReason });
      expect(cloudFormationMock.commandCalls(DescribeStacksCommand)).toHaveLength(0);
    });

    it('answers SUCCESS on Delete with the physical id CloudFormation sent, and logs the problem', async () => {
      await misconfiguredTrigger(deployEndTriggerEvent('Delete')).handle();

      expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: 'deploy-end-physical-id' });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Configuration error on Delete'), {
        error: BAD_CONFIG_ERROR,
      });
    });
  });
});
