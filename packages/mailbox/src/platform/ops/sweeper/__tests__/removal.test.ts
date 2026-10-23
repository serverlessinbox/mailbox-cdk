/// <reference types="jest" />

/**
 * The helpers every removal builds its state-machine chain from. They fix what a worker answer
 * means to the state machine: only RETRY loops, SUCCESS moves on, and any other answer ends in a
 * terminal Fail, so a worker that reports FAILED can never spin the loop for hours. The presence
 * guard keeps a removal from running against a target that is not in the execution input.
 */

import * as sfn                                                           from 'aws-cdk-lib/aws-stepfunctions';
import { Duration }                                                       from 'aws-cdk-lib';

import { stateBodyOf }                                                    from '../../../../__tests__/state-machine-helpers';
import type { CertWorkerInput }                                           from '../../../../runtime/resource-sweeper/removal';
import { newTestStack }                                                   from '../../../__tests__/platform-helpers';
import { buildWorkerRetryLoop, targetField, withTargetPresenceGuard }     from '../removal';

import {
  nameOfStateWhere,
  newWorkerFunction,
  renderDefinition,
  startStateOf,
  stateOf,
  statusTargetOf,
} from './sweeper-helpers';

describe('removal chain helpers', () => {
  const retryInterval = Duration.minutes(5);

  function certPayload(): CertWorkerInput {
    return { removalType: 'cert', certArn: targetField('cert', 'certArn'), rootStackName: 'root-stack', rootStackId: 'guid-1' };
  }

  describe('buildWorkerRetryLoop', () => {
    function renderLoop(gracePeriod?: Duration): string {
      const stack     = newTestStack('RetryLoopStack');
      const onSuccess = new sfn.Succeed(stack, 'Done');
      const entry     = buildWorkerRetryLoop(stack, 'cert', {
        worker:  newWorkerFunction(stack),
        payload: certPayload(),
        retryInterval,
        onSuccess,
        failureCause: 'Certificate removal failed',
        gracePeriod,
      });
      return renderDefinition(stack, entry);
    }

    it('invokes the worker with the payload read from the execution input', () => {
      const definition = renderLoop();
      const invoke     = nameOfStateWhere(definition, (state) => state.Type === 'Task');
      const choice     = nameOfStateWhere(definition, (state) => state.Type === 'Choice');

      expect(stateBodyOf(definition, invoke)).toContain('"certArn.$":"$.toSweep.cert.certArn"');
      expect(stateBodyOf(definition, invoke)).toContain('"removalType":"cert"');
      expect(stateOf(definition, invoke).Next).toBe(choice);
    });

    it('continues on SUCCESS, waits and invokes again on RETRY, and fails on anything else', () => {
      const definition = renderLoop();
      const invoke     = nameOfStateWhere(definition, (state) => state.Type === 'Task');
      const choice     = nameOfStateWhere(definition, (state) => state.Type === 'Choice');
      const failed     = nameOfStateWhere(definition, (state) => state.Type === 'Fail');
      const retryWait  = statusTargetOf(definition, 'RETRY');

      expect(statusTargetOf(definition, 'SUCCESS')).toBe('Done');
      expect(stateOf(definition, choice).Default).toBe(failed);
      expect(stateBodyOf(definition, retryWait)).toContain('"Seconds":300');
      expect(stateOf(definition, retryWait).Next).toBe(invoke);
      expect(stateBodyOf(definition, failed)).toContain('"Cause":"Certificate removal failed"');
    });

    it('starts at the invoke state when there is no grace period', () => {
      const definition = renderLoop();
      const invoke     = nameOfStateWhere(definition, (state) => state.Type === 'Task');

      expect(startStateOf(definition)).toBe(invoke);
    });

    it('starts with a wait of the grace period, once, before the first invoke', () => {
      const definition = renderLoop(Duration.minutes(15));
      const invoke     = nameOfStateWhere(definition, (state) => state.Type === 'Task');
      const grace      = startStateOf(definition);

      expect(stateBodyOf(definition, grace)).toContain('"Seconds":900');
      expect(stateOf(definition, grace).Next).toBe(invoke);
      expect(stateOf(definition, statusTargetOf(definition, 'RETRY')).Next).toBe(invoke);
    });
  });

  describe('withTargetPresenceGuard', () => {
    it('enters the chain only when the removal id is present in the execution input, else skips to onSuccess', () => {
      const stack     = newTestStack('GuardStack');
      const entry     = new sfn.Pass(stack, 'Entry');
      const onSuccess = new sfn.Succeed(stack, 'Done');
      const guard     = withTargetPresenceGuard(stack, 'HasTarget', 'edge-fn', entry, onSuccess);

      const choice = stateBodyOf(renderDefinition(stack, guard), 'HasTarget');

      expect(choice).toContain('"Variable":"$.toSweep.edge-fn"');
      expect(choice).toContain('"IsPresent":true');
      expect(choice).toContain('"Next":"Entry"');
      expect(choice).toContain('"Default":"Done"');
    });
  });
});
