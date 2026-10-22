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
import { buildWorkerRetryLoop, targetField, withTargetPresenceGuard }     from '../removal';

import { newTestStack, newWorkerFunction, renderDefinition }              from './sweeper-helpers';

describe('removal chain helpers', () => {
  const retryInterval = Duration.minutes(5);

  function certPayload(): CertWorkerInput {
    return { removalType: 'cert', certArn: targetField('cert', 'certArn'), rootStackName: 'root-stack', rootStackId: 'guid-1' };
  }

  describe('buildWorkerRetryLoop', () => {
    function renderLoop(gracePeriod?: Duration): string {
      const stack     = newTestStack('RetryLoopStack');
      const onSuccess = new sfn.Succeed(stack, 'Done');
      const entry     = buildWorkerRetryLoop(stack, 'Cert', {
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
      const invoke = stateBodyOf(renderLoop(), 'CertInvoke');

      expect(invoke).toContain('"certArn.$":"$.toSweep.cert.certArn"');
      expect(invoke).toContain('"removalType":"cert"');
      expect(invoke).toContain('"Next":"CertStatusChoice"');
    });

    it('continues on SUCCESS, waits and invokes again on RETRY, and fails on anything else', () => {
      const definition = renderLoop();
      const choice     = stateBodyOf(definition, 'CertStatusChoice');

      expect(choice).toMatch(/"StringEquals":"SUCCESS"[^}]*"Next":"Done"/);
      expect(choice).toMatch(/"StringEquals":"RETRY"[^}]*"Next":"CertWaitRetry"/);
      expect(choice).toContain('"Default":"CertFailed"');
      expect(stateBodyOf(definition, 'CertWaitRetry')).toContain('"Seconds":300');
      expect(stateBodyOf(definition, 'CertWaitRetry')).toContain('"Next":"CertInvoke"');
      expect(stateBodyOf(definition, 'CertFailed')).toContain('"Cause":"Certificate removal failed"');
    });

    it('starts at the invoke state when there is no grace period', () => {
      const definition = renderLoop();

      expect(definition).toContain('"StartAt":"CertInvoke"');
      expect(definition).not.toContain('CertGraceWait');
    });

    it('starts with a wait of the grace period, once, before the first invoke', () => {
      const definition = renderLoop(Duration.minutes(15));

      expect(definition).toContain('"StartAt":"CertGraceWait"');
      expect(stateBodyOf(definition, 'CertGraceWait')).toContain('"Seconds":900');
      expect(stateBodyOf(definition, 'CertGraceWait')).toContain('"Next":"CertInvoke"');
      expect(stateBodyOf(definition, 'CertWaitRetry')).toContain('"Next":"CertInvoke"');
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
