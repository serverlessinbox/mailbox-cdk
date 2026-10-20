/**
 * Coverage for `SweepTargetPlanner`, the diff that decides what a custom-resource request sweeps.
 * An Update that replaces a cert or edge function must sweep the OLD one: the new state machine
 * definition never mentions it once the removals move on, so a planner that dropped the Update diff
 * would orphan the old resource. CloudFormation's own keys must never be taken for removal ids.
 */

import type { CloudFormationCustomResourceEvent } from 'aws-lambda';

import { SweepTargetPlanner }                     from '../sweep-target-planner';

const CERT_ARN_OLD  = 'arn:aws:acm:us-west-2:123456789012:certificate/old-cert';
const CERT_ARN_NEW  = 'arn:aws:acm:us-west-2:123456789012:certificate/new-cert';
const EDGE_FN_ARN   = 'arn:aws:lambda:us-east-1:123456789012:function:edge-fn';
const SERVICE_TOKEN = 'arn:aws:lambda:us-west-2:123456789012:function:starter';

const COMMON = {
  ServiceToken: SERVICE_TOKEN,
  ResponseURL: 'https://example.com/response',
  StackId: 'arn:aws:cloudformation:us-west-2:123456789012:stack/test/abc',
  RequestId: 'request-1',
  LogicalResourceId: 'DeferredRemoval',
  ResourceType: 'Custom::DeferredRemoval',
};

function deleteEvent(resourceProperties: Record<string, unknown>): CloudFormationCustomResourceEvent {
  return {
    ...COMMON,
    RequestType: 'Delete',
    PhysicalResourceId: 'mailbox-deferred-removal',
    ResourceProperties: { ServiceToken: SERVICE_TOKEN, ...resourceProperties },
  };
}

function updateEvent(
  resourceProperties: Record<string, unknown>,
  oldResourceProperties: Record<string, unknown>,
): CloudFormationCustomResourceEvent {
  return {
    ...COMMON,
    RequestType: 'Update',
    PhysicalResourceId: 'mailbox-deferred-removal',
    ResourceProperties: { ServiceToken: SERVICE_TOKEN, ...resourceProperties },
    OldResourceProperties: { ServiceToken: SERVICE_TOKEN, ...oldResourceProperties },
  };
}

function createEvent(resourceProperties: Record<string, unknown>): CloudFormationCustomResourceEvent {
  return {
    ...COMMON,
    RequestType: 'Create',
    ResourceProperties: { ServiceToken: SERVICE_TOKEN, ...resourceProperties },
  };
}

describe('SweepTargetPlanner', () => {
  const planner = new SweepTargetPlanner();

  it('Delete: sweeps every registered removal, and never CloudFormation\'s own keys', () => {
    const event = deleteEvent({
      ServiceTimeout: '120',
      cert: { certArn: CERT_ARN_NEW },
      'edge-fn': { edgeFnArn: EDGE_FN_ARN },
    });

    expect(planner.plan(event)).toEqual({
      cert: { certArn: CERT_ARN_NEW },
      'edge-fn': { edgeFnArn: EDGE_FN_ARN },
    });
  });

  it('Create: nothing exists yet to sweep', () => {
    expect(planner.plan(createEvent({ cert: { certArn: CERT_ARN_NEW } }))).toEqual({});
  });

  it('Update: a changed cert ARN sweeps the OLD arn, leaving the unchanged edge-fn entry alone', () => {
    const event = updateEvent(
      { cert: { certArn: CERT_ARN_NEW }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
      { cert: { certArn: CERT_ARN_OLD }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
    );

    expect(planner.plan(event)).toEqual({ cert: { certArn: CERT_ARN_OLD } });
  });

  it('Update: entries equal by structure, nested arrays included, sweep nothing', () => {
    const event = updateEvent(
      { detector: { ruleArns: ['rule-a', 'rule-b'], retention: { days: '7' } } },
      { detector: { ruleArns: ['rule-a', 'rule-b'], retention: { days: '7' } } },
    );

    expect(planner.plan(event)).toEqual({});
  });

  it('Update: an entry that differs only inside a nested array sweeps its old value', () => {
    const event = updateEvent(
      { detector: { ruleArns: ['rule-a', 'rule-c'] } },
      { detector: { ruleArns: ['rule-a', 'rule-b'] } },
    );

    expect(planner.plan(event)).toEqual({ detector: { ruleArns: ['rule-a', 'rule-b'] } });
  });

  it('Update: a removal disappearing entirely sweeps its old entry', () => {
    const event = updateEvent(
      { 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
      { cert: { certArn: CERT_ARN_OLD }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
    );

    expect(planner.plan(event)).toEqual({ cert: { certArn: CERT_ARN_OLD } });
  });
});
