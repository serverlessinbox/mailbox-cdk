/// <reference types="jest" />

/**
 * Unit tests for cfnTriggerHandler (stack-self-update, Phase B).
 *
 * Exercises the real handler (wrapped by aws-custom-resources' wrapHandler) against each
 * CloudFormation RequestType. The two volatile boundaries are faked:
 *  - '../update-cycle' (real AWS calls) is mocked to isolate the branch logic under test.
 *  - Node's 'https' module (the real network PUT that wrapHandler issues to ResponseURL) is
 *    mocked so the response body can be captured and asserted without a real network call.
 */

import * as https from 'https';
import type { Context, CloudFormationCustomResourceEvent } from 'aws-lambda';
import type { Config } from '../config';
import { createCfnTriggerHandler } from '../cfn-trigger';
import { runUpdateCycle } from '../update-cycle';

jest.mock('../update-cycle', () => ({
  runUpdateCycle: jest.fn(),
}));

jest.mock('https');

const mockRunUpdateCycle = runUpdateCycle as jest.MockedFunction<typeof runUpdateCycle>;
const mockHttpsRequest = https.request as unknown as jest.Mock;

/** Minimal stub context; only fields wrapHandler's CustomResourceHandler reads are load-bearing. */
function fakeContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'artifact-updater',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:artifact-updater',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/artifact-updater',
    logStreamName: 'test-log-stream',
    getRemainingTimeInMillis: () => 600000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };
}

const testConfig: Config = {
  logLevel: 'error',
  serviceName: 'artifact-updater-service',
  project: 'serverlessinbox',
  distTag: 'latest',
  granularity: 'major',
  artifactBucketBase: 'mailbox-artifacts',
  rootStackTagValue: 'my-stack',
};

const baseFields = {
  ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:artifact-updater',
  ResponseURL: 'https://cloudformation-custom-resource-response-url.example.com/',
  StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/guid',
  RequestId: 'request-id-1',
  LogicalResourceId: 'DeployEndTrigger',
  ResourceType: 'Custom::DeployEndTrigger',
};

describe('cfnTriggerHandler', () => {
  let writtenBodies: string[];
  let cfnTriggerHandler: ReturnType<typeof createCfnTriggerHandler>;

  beforeEach(() => {
    jest.clearAllMocks();
    writtenBodies = [];
    cfnTriggerHandler = createCfnTriggerHandler(testConfig, undefined);
    mockHttpsRequest.mockImplementation((_options: unknown, callback: (res: { statusCode: number; headers: Record<string, string> }) => void) => {
      // Simulate CloudFormation accepting the PUT immediately.
      process.nextTick(() => callback({ statusCode: 200, headers: {} }));
      return {
        on: jest.fn(),
        write: jest.fn((body: string) => {
          writtenBodies.push(body);
        }),
        end: jest.fn(),
      };
    });
  });

  it('does not run the update cycle on Delete, and preserves the physical resource id', async () => {
    const event: CloudFormationCustomResourceEvent = {
      ...baseFields,
      RequestType: 'Delete',
      PhysicalResourceId: 'deploy-end-cr-physical-id',
      ResourceProperties: { ServiceToken: baseFields.ServiceToken, Nonce: '123' },
    };

    await cfnTriggerHandler(event, fakeContext(), () => {});

    expect(mockRunUpdateCycle).not.toHaveBeenCalled();
    expect(writtenBodies).toHaveLength(1);
    const response = JSON.parse(writtenBodies[0]);
    expect(response.Status).toBe('SUCCESS');
    // No PhysicalResourceId is returned by the handler for Delete; wrapHandler falls back to
    // the incoming event's PhysicalResourceId, so CloudFormation sees no id change.
    expect(response.PhysicalResourceId).toBe('deploy-end-cr-physical-id');
  });

  it('runs the update cycle on Create', async () => {
    const event: CloudFormationCustomResourceEvent = {
      ...baseFields,
      RequestType: 'Create',
      ResourceProperties: { ServiceToken: baseFields.ServiceToken, Nonce: '123' },
    };

    await cfnTriggerHandler(event, fakeContext(), () => {});

    expect(mockRunUpdateCycle).toHaveBeenCalledTimes(1);
    const response = JSON.parse(writtenBodies[0]);
    expect(response.Status).toBe('SUCCESS');
    expect(response.PhysicalResourceId).toBe('DeployEndTrigger');
  });

  it('runs the update cycle on Update and swallows a failure from it', async () => {
    mockRunUpdateCycle.mockRejectedValueOnce(new Error('boom'));

    const event: CloudFormationCustomResourceEvent = {
      ...baseFields,
      RequestType: 'Update',
      PhysicalResourceId: 'deploy-end-cr-physical-id',
      ResourceProperties: { ServiceToken: baseFields.ServiceToken, Nonce: '456' },
      OldResourceProperties: { ServiceToken: baseFields.ServiceToken, Nonce: '123' },
    };

    await cfnTriggerHandler(event, fakeContext(), () => {});

    expect(mockRunUpdateCycle).toHaveBeenCalledTimes(1);
    // The error is caught and swallowed (documented, deliberate behavior) so CFN still sees SUCCESS.
    const response = JSON.parse(writtenBodies[0]);
    expect(response.Status).toBe('SUCCESS');
  });

  it('fails Create on config error and does not run the update cycle', async () => {
    writtenBodies = [];
    const cfnTriggerHandlerWithError = createCfnTriggerHandler(testConfig, 'LOG_LEVEL: invalid');
    mockHttpsRequest.mockImplementation((_options: unknown, callback: (res: { statusCode: number; headers: Record<string, string> }) => void) => {
      process.nextTick(() => callback({ statusCode: 200, headers: {} }));
      return {
        on: jest.fn(),
        write: jest.fn((body: string) => {
          writtenBodies.push(body);
        }),
        end: jest.fn(),
      };
    });

    const event: CloudFormationCustomResourceEvent = {
      ...baseFields,
      RequestType: 'Create',
      ResourceProperties: { ServiceToken: baseFields.ServiceToken, Nonce: '123' },
    };

    await cfnTriggerHandlerWithError(event, fakeContext(), () => {});

    expect(mockRunUpdateCycle).not.toHaveBeenCalled();
    expect(writtenBodies).toHaveLength(1);
    const response = JSON.parse(writtenBodies[0]);
    expect(response.Status).toBe('FAILED');
  });
});
