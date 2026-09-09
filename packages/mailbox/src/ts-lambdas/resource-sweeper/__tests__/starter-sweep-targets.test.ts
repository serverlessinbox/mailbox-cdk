/**
 * Coverage for `computeSweepTargets` — the diffing logic that restores the sweeper's Update-path
 * behaviour the per-removal-type rework dropped (see `handler.ts`). This is the exact behaviour that
 * regressed: an Update replacing a cert or edge function's ARN must sweep the OLD one, since the new
 * state machine definition never contains it once the CDK's own removals move on.
 */

import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import { computeSweepTargets } from '../handler';

const CERT_ARN_OLD = 'arn:aws:acm:us-west-2:123456789012:certificate/old-cert';
const CERT_ARN_NEW = 'arn:aws:acm:us-west-2:123456789012:certificate/new-cert';
const EDGE_FN_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:edge-fn';

const COMMON = {
  ServiceToken: 'arn:aws:lambda:us-west-2:123456789012:function:starter',
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
    ResourceProperties: resourceProperties as any,
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
    ResourceProperties: resourceProperties as any,
    OldResourceProperties: oldResourceProperties as any,
  };
}

function createEvent(resourceProperties: Record<string, unknown>): CloudFormationCustomResourceEvent {
  return {
    ...COMMON,
    RequestType: 'Create',
    ResourceProperties: resourceProperties as any,
  };
}

describe('computeSweepTargets', () => {
  it('Delete: sweeps every registered removal present in ResourceProperties', () => {
    const event = deleteEvent({
      cert: { certArn: CERT_ARN_NEW },
      'edge-fn': { edgeFnArn: EDGE_FN_ARN },
    });

    expect(computeSweepTargets(event)).toEqual({
      cert: { certArn: CERT_ARN_NEW },
      'edge-fn': { edgeFnArn: EDGE_FN_ARN },
    });
  });

  it('Create: nothing exists yet to sweep', () => {
    const event = createEvent({ cert: { certArn: CERT_ARN_NEW } });
    expect(computeSweepTargets(event)).toEqual({});
  });

  it('Update: a changed cert ARN sweeps the OLD arn, leaving the unchanged edge-fn entry alone', () => {
    const event = updateEvent(
      { cert: { certArn: CERT_ARN_NEW }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
      { cert: { certArn: CERT_ARN_OLD }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
    );

    expect(computeSweepTargets(event)).toEqual({ cert: { certArn: CERT_ARN_OLD } });
  });

  it('Update: nothing changed sweeps nothing', () => {
    const event = updateEvent(
      { cert: { certArn: CERT_ARN_NEW }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
      { cert: { certArn: CERT_ARN_NEW }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
    );

    expect(computeSweepTargets(event)).toEqual({});
  });

  it('Update: a removal disappearing entirely (no longer registered) sweeps its old entry', () => {
    const event = updateEvent(
      { 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
      { cert: { certArn: CERT_ARN_OLD }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
    );

    expect(computeSweepTargets(event)).toEqual({ cert: { certArn: CERT_ARN_OLD } });
  });

  it('BWCOMPAT: an Update whose OldResourceProperties are in the pre-rework flat shape sweeps the old cert ARN', () => {
    // Simulates the very first update after this ships: the already-deployed stack's custom
    // resource carried the old flat `CertArn`/`EdgeFnArn` properties, but the newly synthesized
    // template already uses the per-removal-type keyed map.
    const event = updateEvent(
      { cert: { certArn: CERT_ARN_NEW }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
      { CertArn: CERT_ARN_OLD, EdgeFnArn: EDGE_FN_ARN },
    );

    expect(computeSweepTargets(event)).toEqual({ cert: { certArn: CERT_ARN_OLD } });
  });

  it('BWCOMPAT: an old flat shape with an unchanged edge-fn ARN sweeps only the changed cert', () => {
    const event = updateEvent(
      { cert: { certArn: CERT_ARN_NEW }, 'edge-fn': { edgeFnArn: EDGE_FN_ARN } },
      { CertArn: CERT_ARN_OLD, EdgeFnArn: EDGE_FN_ARN },
    );

    const result = computeSweepTargets(event);
    expect(result).toEqual({ cert: { certArn: CERT_ARN_OLD } });
    expect(result['edge-fn']).toBeUndefined();
  });
});
