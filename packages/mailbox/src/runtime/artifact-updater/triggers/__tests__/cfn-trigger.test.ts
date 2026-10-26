/// <reference types="jest" />

/**
 * Pins how the deploy-end trigger answers CloudFormation: Create and Update run the update cycle and answer
 * with the logical id as physical id, Delete answers without running it so CloudFormation keeps the physical id
 * it has, a bad configuration is handed to the shared bad-configuration answer with the request and the problem,
 * except to an Update while the parent stack rolls back (answering FAILED there strands the stack in
 * UPDATE_ROLLBACK_FAILED), and a failed cycle still answers SUCCESS so the stack's deployment goes on while the
 * failure is thrown afterwards for the handler to flush the trace. The update cycle, the stack status and the
 * shared answer and manual-finalize helpers are faked, because each has its own suite; the response is read from
 * the request sent to the ResponseURL.
 */

import {
  answerRequestWithBadConfig,
  emitManualFinalize,
  ParentStackStatus,
  toPhysicalResourceId,
} from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type * as LambdaRuntime                                               from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { captureCfnResponse, type CapturedCfnResponse }                      from '@serverlessinbox/mailbox-cdk-shared/runtime-test-support';
import type { CloudFormationCustomResourceEvent }                            from 'aws-lambda';

import {
  BAD_CONFIG_ERROR,
  badConfigCycle,
  deployEndTriggerEvent,
  fakeCloudFormationClient,
  fakeLambdaContext,
  newUpdateCycle,
} from '../../__tests__/updater-helpers';
import { UpdateCycle }                                                      from '../../update-cycle';
import { CfnTrigger }                                                       from '../cfn-trigger';

jest.mock('../../update-cycle');
jest.mock('https', () => ({
  request: jest.fn(),
}));
jest.mock('@serverlessinbox/mailbox-cdk-shared/lambda-runtime', () => ({
  ...jest.requireActual<typeof LambdaRuntime>('@serverlessinbox/mailbox-cdk-shared/lambda-runtime'),
  answerRequestWithBadConfig: jest.fn(),
  emitManualFinalize:         jest.fn(),
}));

describe('CfnTrigger', () => {
  const sharedBadConfigAnswer = { PhysicalResourceId: toPhysicalResourceId('answer-of-the-shared-helper') };
  let cfnResponse: () => CapturedCfnResponse;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(answerRequestWithBadConfig).mockReturnValue(sharedBadConfigAnswer);
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

  function parentStackRollingBack(rollingBack: boolean): jest.SpyInstance {
    return jest.spyOn(ParentStackStatus.prototype, 'isRollingBack').mockResolvedValue(rollingBack);
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

  it('hands the request and the configured service name to the manual-finalize hint', async () => {
    const event = deployEndTriggerEvent('Delete');

    await healthyTrigger(event).handle();

    expect(emitManualFinalize).toHaveBeenCalledWith(
      expect.objectContaining({ RequestType: 'Delete', StackId: event.StackId, LogicalResourceId: event.LogicalResourceId }),
      { service: 'artifact-updater' },
    );
  });

  describe('when the configuration failed to load', () => {
    it.each(['Create', 'Delete'] as const)('answers a %s with what the shared bad-configuration answer gives for the request and the problem, running no cycle', async (requestType) => {
      const event = deployEndTriggerEvent(requestType);

      await misconfiguredTrigger(event).handle();

      expect(answerRequestWithBadConfig).toHaveBeenCalledWith(
        expect.objectContaining({ RequestType: requestType, StackId: event.StackId }),
        BAD_CONFIG_ERROR,
      );
      expect(cfnResponse()).toMatchObject({ PhysicalResourceId: sharedBadConfigAnswer.PhysicalResourceId });
      expect(cycleRuns()).not.toHaveBeenCalled();
    });

    it('answers SUCCESS on an Update while the parent stack rolls back, with the physical id CloudFormation sent', async () => {
      const event         = deployEndTriggerEvent('Update');
      const isRollingBack = parentStackRollingBack(true);

      await misconfiguredTrigger(event).handle();

      expect(isRollingBack).toHaveBeenCalledWith(event.StackId);
      expect(answerRequestWithBadConfig).not.toHaveBeenCalled();
      expect(cfnResponse()).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: 'deploy-end-physical-id' });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Configuration error on Update'), {
        error: BAD_CONFIG_ERROR,
      });
    });

    it('hands an Update to the shared bad-configuration answer when the parent stack is not rolling back', async () => {
      parentStackRollingBack(false);

      await misconfiguredTrigger(deployEndTriggerEvent('Update')).handle();

      expect(answerRequestWithBadConfig).toHaveBeenCalledWith(expect.objectContaining({ RequestType: 'Update' }), BAD_CONFIG_ERROR);
      expect(cfnResponse()).toMatchObject({ PhysicalResourceId: sharedBadConfigAnswer.PhysicalResourceId });
    });

    it('does not read the parent stack status for a Create', async () => {
      const isRollingBack = parentStackRollingBack(true);

      await misconfiguredTrigger(deployEndTriggerEvent('Create')).handle();

      expect(isRollingBack).not.toHaveBeenCalled();
      expect(answerRequestWithBadConfig).toHaveBeenCalledTimes(1);
    });
  });
});
