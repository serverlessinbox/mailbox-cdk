/**
 * Coverage for `SweepWorkerComposition`: the clients of the worker's sweepers are built in the regions the
 * sweepers need. Every client takes the region of the worker config, except the Lambda client of the edge
 * function sweeper, which must be us-east-1 because Lambda@Edge functions live there only: a client in the
 * stack's region would look for the edge function where it does not exist and report it already deleted.
 * The sweepers are driven with "not found" answers, so each sweep ends after its first call.
 */

import { ACMClient, ListTagsForCertificateCommand }          from '@aws-sdk/client-acm';
import { EventBridgeClient, ListTagsForResourceCommand }     from '@aws-sdk/client-eventbridge';
import { IAMClient, ListRoleTagsCommand }                    from '@aws-sdk/client-iam';
import { LambdaClient, GetFunctionCommand }                  from '@aws-sdk/client-lambda';
import { LoggerBuffer, toRegion }                            from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                        from 'aws-sdk-client-mock';

import { SweepWorkerComposition }                            from '../sweep-worker-composition';

const acmMock         = mockClient(ACMClient);
const lambdaMock      = mockClient(LambdaClient);
const eventBridgeMock = mockClient(EventBridgeClient);
const iamMock         = mockClient(IAMClient);

const STACK_REGION = 'eu-west-1';
const ROOT_STACK   = { rootStackName: 'test-stack', rootStackId: 'guid-1' };

function notFound(name: string): Error {
  return Object.assign(new Error('not found'), { name });
}

async function regionOfSender(sender: unknown): Promise<string> {
  if (!(sender instanceof ACMClient || sender instanceof LambdaClient || sender instanceof EventBridgeClient || sender instanceof IAMClient)) {
    throw new Error('the call was not made by an AWS client');
  }
  return sender.config.region();
}

function sweepWorker() {
  const composition = new SweepWorkerComposition({ logLevel: 'error', serviceName: 'sweeper', region: toRegion(STACK_REGION) });
  return composition.sweepWorker(new LoggerBuffer());
}

describe('SweepWorkerComposition', () => {
  beforeEach(() => {
    acmMock.reset();
    lambdaMock.reset();
    eventBridgeMock.reset();
    iamMock.reset();
  });

  it('calls ACM in the region of the config for a certificate', async () => {
    acmMock.on(ListTagsForCertificateCommand).rejects(notFound('ResourceNotFoundException'));

    await sweepWorker().handle({ removalType: 'cert', certArn: 'arn:aws:acm:eu-west-1:123456789012:certificate/c', ...ROOT_STACK });

    expect(await regionOfSender(acmMock.call(0).thisValue)).toBe(STACK_REGION);
  });

  it('calls Lambda in us-east-1 for an edge function, whatever the region of the config', async () => {
    lambdaMock.on(GetFunctionCommand).rejects(notFound('ResourceNotFoundException'));

    await sweepWorker().handle({ removalType: 'edge-fn', edgeFnArn: 'arn:aws:lambda:us-east-1:123456789012:function:edge', ...ROOT_STACK });

    expect(await regionOfSender(lambdaMock.call(0).thisValue)).toBe('us-east-1');
  });

  it('calls EventBridge, Lambda and IAM in the region of the config for the stack-failure detector', async () => {
    eventBridgeMock.on(ListTagsForResourceCommand).rejects(notFound('ResourceNotFoundException'));
    lambdaMock.on(GetFunctionCommand).rejects(notFound('ResourceNotFoundException'));
    iamMock.on(ListRoleTagsCommand).rejects(notFound('NoSuchEntityException'));

    await sweepWorker().handle({
      removalType: 'detector',
      target:      {
        ruleArn:                'arn:aws:events:eu-west-1:123456789012:rule/r',
        ruleTargetId:           'Target0',
        detectorFnArn:          'arn:aws:lambda:eu-west-1:123456789012:function:f',
        detectorRoleArn:        'arn:aws:iam::123456789012:role/ro',
        detectorRolePolicyName: 'p',
      },
      ...ROOT_STACK,
    });

    expect(await regionOfSender(eventBridgeMock.call(0).thisValue)).toBe(STACK_REGION);
    expect(await regionOfSender(lambdaMock.call(0).thisValue)).toBe(STACK_REGION);
    expect(await regionOfSender(iamMock.call(0).thisValue)).toBe(STACK_REGION);
  });

  it('calls IAM in the region of the config for the sweeper worker role', async () => {
    iamMock.on(ListRoleTagsCommand).rejects(notFound('NoSuchEntityException'));

    await sweepWorker().handle({
      removalType:          'sweeper-role',
      workerRoleArn:        'arn:aws:iam::123456789012:role/mailbox-sweeper-worker-aaaa1111-bbbb2222',
      workerRolePolicyName: 'worker-policy',
      ...ROOT_STACK,
    });

    expect(await regionOfSender(iamMock.call(0).thisValue)).toBe(STACK_REGION);
  });
});
