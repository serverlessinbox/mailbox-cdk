/**
 * Fixtures shared by the starter-side tests: CloudFormation custom-resource events that each carry
 * one removal entry, and the capture of the response a `wrapHandler`-wrapped handler PUTs.
 */

import { CloudFormationClient }                            from '@aws-sdk/client-cloudformation';
import { SFNClient }                                       from '@aws-sdk/client-sfn';
import { LoggerBuffer, ParentStackStatus }                 from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import * as https                                          from 'https';
import { Writable }                                        from 'stream';
import * as t                                              from 'typanion';

import { SweepStarter }                                    from '../sweep-starter';
import { SweepTargetPlanner }                              from '../sweep-target-planner';

export const STATE_MACHINE_ARN = 'arn:aws:states:us-west-2:123456789012:stateMachine:mailbox-sweeper-ops-abc123';

/** A `SweepStarter` on the default clients; a test's `mockClient(SFNClient)` / `mockClient(CloudFormationClient)` intercepts them. */
export function createSweepStarter(): SweepStarter {
  const logger = new LoggerBuffer('resource-sweeper-starter', 'error');
  return new SweepStarter(
    { logLevel: 'error', serviceName: 'resource-sweeper-starter', sweeperStateMachineArn: STATE_MACHINE_ARN },
    new SFNClient({ region: 'us-west-2' }),
    new ParentStackStatus(new CloudFormationClient({ region: 'us-west-2' }), logger),
    new SweepTargetPlanner(),
    logger,
  );
}

const isCapturedCfnResponse = t.isPartial({
  Status: t.isString(),
  Reason: t.isOptional(t.isString()),
  PhysicalResourceId: t.isOptional(t.isString()),
});

/** The fields of the CloudFormation response the starter PUTs that its tests assert on. */
export type CapturedCfnResponse = t.InferType<typeof isCapturedCfnResponse>;

export const PARENT_STACK_ID = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test/abc';
const OLD_CERT_ARN = 'arn:aws:acm:us-west-2:123456789012:certificate/old';

const baseEvent = {
  ServiceToken: 'arn:aws:lambda:us-west-2:123456789012:function:starter',
  ResponseURL: 'https://example.com/response',
  StackId: PARENT_STACK_ID,
  RequestId: 'request-1',
  LogicalResourceId: 'DeferredRemoval',
  ResourceType: 'Custom::DeferredRemoval',
};

export function createEvent(): CloudFormationCustomResourceEvent {
  return {
    ...baseEvent,
    RequestType: 'Create',
    ResourceProperties: { ServiceToken: baseEvent.ServiceToken, cert: { certArn: OLD_CERT_ARN } },
  };
}

/** A Delete carrying one removal entry, so a sweep has exactly one target to forward. */
export function deleteEvent(): CloudFormationCustomResourceEvent {
  return {
    ...baseEvent,
    RequestType: 'Delete',
    PhysicalResourceId: 'mailbox-deferred-removal',
    ResourceProperties: { ServiceToken: baseEvent.ServiceToken, cert: { certArn: OLD_CERT_ARN } },
  };
}

/** An Update whose removal entry disappeared, so its old value is the sweep target. */
export function updateEvent(): CloudFormationCustomResourceEvent {
  return {
    ...baseEvent,
    RequestType: 'Update',
    PhysicalResourceId: 'mailbox-deferred-removal',
    ResourceProperties: { ServiceToken: baseEvent.ServiceToken },
    OldResourceProperties: { ServiceToken: baseEvent.ServiceToken, cert: { certArn: OLD_CERT_ARN } },
  };
}

export const OLD_REMOVAL_ENTRY = { certArn: OLD_CERT_ARN };

export function lambdaContext(): Context {
  return {
    getRemainingTimeInMillis: () => 30000,
    logStreamName: 'log-stream',
    logGroupName: 'log-group',
  } as unknown as Context;
}

/**
 * Routes the mocked `https.request` (the test file must `jest.mock('https', ...)`) into a Writable
 * and returns a function yielding the CloudFormation response body the handler PUT to ResponseURL.
 */
export function captureCfnResponse(): () => CapturedCfnResponse {
  let body = '';
  jest.mocked(https.request).mockImplementation(((...[, callback]: [unknown, ((res: { statusCode: number }) => void)?]) => {
    if (callback) {
      callback({ statusCode: 200 });
    }
    return new Writable({
      write(...[chunk, , done]: [Buffer, BufferEncoding, () => void]) {
        body += chunk.toString();
        done();
      },
    });
  }) as typeof https.request);
  return () => {
    const sent: unknown = JSON.parse(body);
    t.assert(sent, isCapturedCfnResponse);
    return sent;
  };
}
