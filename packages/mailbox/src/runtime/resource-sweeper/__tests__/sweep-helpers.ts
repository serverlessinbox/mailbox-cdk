/**
 * Fixtures shared by the starter-side tests: CloudFormation custom-resource events that each carry one removal
 * entry, with the `ServiceTimeout` the deferred-removal construct sends.
 */

import { DeleteCertificateCommand, DescribeCertificateCommand, ListTagsForCertificateCommand } from '@aws-sdk/client-acm';
import type { ACMClient }                                                                      from '@aws-sdk/client-acm';
import { CloudFormationClient }                                                                from '@aws-sdk/client-cloudformation';
import { SFNClient }                                                                           from '@aws-sdk/client-sfn';
import { LoggerBuffer, ParentStackStatus, toRegion }                                           from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { CloudFormationCustomResourceEvent, Context }                                     from 'aws-lambda';
import type { AwsClientStub }                                                                  from 'aws-sdk-client-mock';

import { SweepStarter }                                                                        from '../sweep-starter';
import { SweepTargetPlanner }                                                                  from '../sweep-target-planner';

export const STATE_MACHINE_ARN = 'arn:aws:states:us-west-2:123456789012:stateMachine:mailbox-sweeper-ops-abc123';

/** A `SweepStarter` on the default clients; a test's `mockClient(SFNClient)` / `mockClient(CloudFormationClient)` intercepts them. */
export function createSweepStarter(): SweepStarter {
  const logger = new LoggerBuffer('resource-sweeper-starter', 'error');
  return new SweepStarter(
    { logLevel: 'error', serviceName: 'resource-sweeper-starter', region: toRegion('us-west-2'), sweeperStateMachineArn: STATE_MACHINE_ARN },
    new SFNClient({ region: 'us-west-2' }),
    new ParentStackStatus(new CloudFormationClient({ region: 'us-west-2' }), logger),
    new SweepTargetPlanner(),
    logger,
  );
}

export const PARENT_STACK_ID = 'arn:aws:cloudformation:us-west-2:123456789012:stack/test/abc';
const OLD_CERT_ARN           = 'arn:aws:acm:us-west-2:123456789012:certificate/old';

const baseEvent = {
  ServiceToken:      'arn:aws:lambda:us-west-2:123456789012:function:starter',
  ResponseURL:       'https://example.com/response',
  StackId:           PARENT_STACK_ID,
  RequestId:         'request-1',
  LogicalResourceId: 'DeferredRemoval',
  ResourceType:      'Custom::DeferredRemoval',
};

/** The custom-resource properties the deferred-removal construct sends: its service token and timeout, then the removal entries. */
const TEMPLATE_KEYS = { ServiceToken: baseEvent.ServiceToken, ServiceTimeout: '120' };

export function createEvent(): CloudFormationCustomResourceEvent {
  return {
    ...baseEvent,
    RequestType:        'Create',
    ResourceProperties: { ...TEMPLATE_KEYS, cert: { certArn: OLD_CERT_ARN } },
  };
}

/** A Delete carrying one removal entry, so a sweep has exactly one target to forward. */
export function deleteEvent(): CloudFormationCustomResourceEvent {
  return {
    ...baseEvent,
    RequestType:        'Delete',
    PhysicalResourceId: 'mailbox-deferred-removal',
    ResourceProperties: { ...TEMPLATE_KEYS, cert: { certArn: OLD_CERT_ARN } },
  };
}

/** An Update whose removal entry disappeared, so its old value is the sweep target. */
export function updateEvent(): CloudFormationCustomResourceEvent {
  return {
    ...baseEvent,
    RequestType:           'Update',
    PhysicalResourceId:    'mailbox-deferred-removal',
    ResourceProperties:    { ...TEMPLATE_KEYS },
    OldResourceProperties: { ...TEMPLATE_KEYS, cert: { certArn: OLD_CERT_ARN } },
  };
}

export const OLD_REMOVAL_ENTRY = { certArn: OLD_CERT_ARN };

/** The ACM answers of a cert removal whose root-stack tag matches and whose certificate is not in use, so the worker deletes it. */
export function answerCertificateRemoval(acmMock: AwsClientStub<ACMClient>): void {
  acmMock.on(ListTagsForCertificateCommand).resolves({
    Tags: [{ Key: 'serverless-inbox:root-stack', Value: 'test-stack' }],
  });
  acmMock.on(DescribeCertificateCommand).resolves({ Certificate: { InUseBy: [] } });
  acmMock.on(DeleteCertificateCommand).resolves({});
}

export function lambdaContext(): Context {
  return {
    getRemainingTimeInMillis: () => 30000,
    logStreamName:            'log-stream',
    logGroupName:             'log-group',
  } as unknown as Context;
}
