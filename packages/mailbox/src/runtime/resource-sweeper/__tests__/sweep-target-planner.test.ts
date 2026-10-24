/**
 * Coverage for `SweepTargetPlanner`, the diff that decides what a custom-resource request sweeps.
 * An Update that replaces a cert or edge function must sweep the OLD one: the new state machine
 * definition never mentions it once the removals move on, so a planner that dropped the Update diff
 * would orphan the old resource. A part of a removal whose identity is unchanged is live and must
 * never be swept, whatever else in the removal changed. CloudFormation's own keys must never be
 * taken for removal ids.
 */

import type { CloudFormationCustomResourceEvent } from 'aws-lambda';

import type { StackFailureDetectorRemovalTarget } from '../removal';
import { SweepTargetPlanner }                     from '../sweep-target-planner';

const CERT_ARN_OLD  = 'arn:aws:acm:us-west-2:123456789012:certificate/old-cert';
const CERT_ARN_NEW  = 'arn:aws:acm:us-west-2:123456789012:certificate/new-cert';
const EDGE_FN_ARN   = 'arn:aws:lambda:us-east-1:123456789012:function:edge-fn';
const SERVICE_TOKEN = 'arn:aws:lambda:us-west-2:123456789012:function:starter';

const DETECTOR: StackFailureDetectorRemovalTarget = {
  ruleArn:                'arn:aws:events:us-west-2:123456789012:rule/rule-old',
  ruleTargetId:           'Target0',
  detectorFnArn:          'arn:aws:lambda:us-west-2:123456789012:function:mailbox-diag-fn',
  detectorRoleArn:        'arn:aws:iam::123456789012:role/mailbox-diag-role',
  detectorRolePolicyName: 'stack-failure-detector-policy',
};
const NEW_RULE_ARN                                = 'arn:aws:events:us-west-2:123456789012:rule/rule-new';
const NEW_FN_ARN                                  = 'arn:aws:lambda:us-west-2:123456789012:function:mailbox-diag-fn-2';
const NEW_ROLE_ARN                                = 'arn:aws:iam::123456789012:role/mailbox-diag-role-2';

const SWEEPER_ROLE_OLD     = {
  workerRoleArn:        'arn:aws:iam::123456789012:role/mailbox-sweeper-worker-aaaa1111-bbbb2222',
  workerRolePolicyName: 'worker-policy',
};
const SWEEPER_ROLE_NEW_ARN = 'arn:aws:iam::123456789012:role/mailbox-sweeper-worker-cccc3333-bbbb2222';

const COMMON = {
  ServiceToken:      SERVICE_TOKEN,
  ResponseURL:       'https://example.com/response',
  StackId:           'arn:aws:cloudformation:us-west-2:123456789012:stack/test/abc',
  RequestId:         'request-1',
  LogicalResourceId: 'DeferredRemoval',
  ResourceType:      'Custom::DeferredRemoval',
};

function deleteEvent(resourceProperties: Record<string, unknown>): CloudFormationCustomResourceEvent {
  return {
    ...COMMON,
    RequestType:        'Delete',
    PhysicalResourceId: 'mailbox-deferred-removal',
    ResourceProperties: { ServiceToken: SERVICE_TOKEN, ServiceTimeout: '120', ...resourceProperties },
  };
}

function updateEvent(
  resourceProperties: Record<string, unknown>,
  oldResourceProperties: Record<string, unknown>,
): CloudFormationCustomResourceEvent {
  return {
    ...COMMON,
    RequestType:           'Update',
    PhysicalResourceId:    'mailbox-deferred-removal',
    ResourceProperties:    { ServiceToken: SERVICE_TOKEN, ServiceTimeout: '120', ...resourceProperties },
    OldResourceProperties: { ServiceToken: SERVICE_TOKEN, ServiceTimeout: '120', ...oldResourceProperties },
  };
}

function createEvent(resourceProperties: Record<string, unknown>): CloudFormationCustomResourceEvent {
  return {
    ...COMMON,
    RequestType:        'Create',
    ResourceProperties: { ServiceToken: SERVICE_TOKEN, ServiceTimeout: '120', ...resourceProperties },
  };
}

describe('SweepTargetPlanner', () => {
  const planner = new SweepTargetPlanner();

  it('Delete: sweeps every registered removal whole, and never CloudFormation\'s own keys', () => {
    const event = deleteEvent({
      ServiceTimeout: '120',
      cert:           { certArn: CERT_ARN_NEW },
      'edge-fn':      { edgeFnArn: EDGE_FN_ARN },
      detector:       DETECTOR,
    });

    expect(planner.plan(event)).toEqual({
      cert:      { certArn: CERT_ARN_NEW },
      'edge-fn': { edgeFnArn: EDGE_FN_ARN },
      detector:  DETECTOR,
    });
  });

  it('Delete: plans the other removals and never the sweeper worker role, which the self-cleanup tail removes', () => {
    const event = deleteEvent({
      cert:           { certArn: CERT_ARN_NEW },
      'sweeper-role': SWEEPER_ROLE_OLD,
    });

    expect(planner.plan(event)).toEqual({ cert: { certArn: CERT_ARN_NEW } });
  });

  it('Create: nothing exists yet to sweep', () => {
    expect(planner.plan(createEvent({ cert: { certArn: CERT_ARN_NEW } }))).toEqual({});
  });

  describe('Update', () => {
    it('a changed cert ARN sweeps the OLD arn, leaving the unchanged edge-fn entry alone', () => {
      const event = updateEvent(
        { cert: { certArn: CERT_ARN_NEW }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
        { cert: { certArn: CERT_ARN_OLD }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
      );

      expect(planner.plan(event)).toEqual({ cert: { certArn: CERT_ARN_OLD } });
    });

    it('a changed worker role ARN sweeps the OLD role with its policy name', () => {
      const event = updateEvent(
        { 'sweeper-role': { ...SWEEPER_ROLE_OLD, workerRoleArn: SWEEPER_ROLE_NEW_ARN } },
        { 'sweeper-role': SWEEPER_ROLE_OLD },
      );

      expect(planner.plan(event)).toEqual({ 'sweeper-role': SWEEPER_ROLE_OLD });
    });

    it('an unchanged worker role sweeps nothing', () => {
      const event = updateEvent({ 'sweeper-role': SWEEPER_ROLE_OLD }, { 'sweeper-role': SWEEPER_ROLE_OLD });

      expect(planner.plan(event)).toEqual({});
    });

    it('a removal disappearing entirely sweeps all of its parts', () => {
      const event = updateEvent(
        { 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
        { 'edge-fn': { edgeFnArn: EDGE_FN_ARN }, detector: DETECTOR },
      );

      expect(planner.plan(event)).toEqual({ detector: DETECTOR });
    });

    it('a detector that is unchanged sweeps nothing', () => {
      const event = updateEvent({ detector: DETECTOR }, { detector: DETECTOR });

      expect(planner.plan(event)).toEqual({});
    });

    it('a detector whose rule alone changed sweeps the OLD rule only, never the live function and role', () => {
      const event = updateEvent({ detector: { ...DETECTOR, ruleArn: NEW_RULE_ARN } }, { detector: DETECTOR });

      expect(planner.plan(event)).toEqual({ detector: { ruleArn: DETECTOR.ruleArn, ruleTargetId: DETECTOR.ruleTargetId } });
    });

    it('a detector whose role alone changed sweeps the OLD role only, with its policy name', () => {
      const event = updateEvent({ detector: { ...DETECTOR, detectorRoleArn: NEW_ROLE_ARN } }, { detector: DETECTOR });

      expect(planner.plan(event)).toEqual({
        detector: { detectorRoleArn: DETECTOR.detectorRoleArn, detectorRolePolicyName: DETECTOR.detectorRolePolicyName },
      });
    });

    it('a detector whose function alone changed sweeps the OLD function only', () => {
      const event = updateEvent({ detector: { ...DETECTOR, detectorFnArn: NEW_FN_ARN } }, { detector: DETECTOR });

      expect(planner.plan(event)).toEqual({ detector: { detectorFnArn: DETECTOR.detectorFnArn } });
    });

    it('a detector whose rule and role changed sweeps both OLD parts and leaves the function out', () => {
      const event = updateEvent(
        { detector: { ...DETECTOR, ruleArn: NEW_RULE_ARN, detectorRoleArn: NEW_ROLE_ARN } },
        { detector: DETECTOR },
      );

      expect(planner.plan(event)).toEqual({
        detector: {
          ruleArn:                DETECTOR.ruleArn,
          ruleTargetId:           DETECTOR.ruleTargetId,
          detectorRoleArn:        DETECTOR.detectorRoleArn,
          detectorRolePolicyName: DETECTOR.detectorRolePolicyName,
        },
      });
    });

    it('a detail of a part that kept its identity, such as the policy name, sweeps nothing', () => {
      const event = updateEvent({ detector: { ...DETECTOR, detectorRolePolicyName: 'renamed-policy' } }, { detector: DETECTOR });

      expect(planner.plan(event)).toEqual({});
    });

    it('a removal this version does not know has no sweeper, so it plans nothing', () => {
      const event = updateEvent({}, { queue: { queueArn: 'arn:aws:sqs:us-west-2:123456789012:q' } });

      expect(planner.plan(event)).toEqual({});
    });

    it('an old entry that is not what its removal registered is a defect naming the removal and the entry', () => {
      const event = updateEvent({ detector: DETECTOR }, { detector: { ruleArn: DETECTOR.ruleArn } });

      expect(() => planner.plan(event)).toThrow(/Invalid detector entry in OldResourceProperties: missing .*detectorFnArn.*Entry: .*"ruleArn"/);
    });
  });
});
