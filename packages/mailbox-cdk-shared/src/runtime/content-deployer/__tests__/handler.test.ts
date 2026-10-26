/// <reference types="jest" />

/**
 * Pins what the content-deployer handler file decides: a bad configuration is answered to CloudFormation
 * (FAILED, but SUCCESS on Delete so a stack in DELETE_FAILED can still be deleted), the buffered trace is
 * flushed only for an unexpected error, and a failed Update during a rollback is answered SUCCESS. The
 * response is read from the request the handler sends to the ResponseURL.
 */

import type * as CloudFormationSdk from '@aws-sdk/client-cloudformation';
import type * as CloudFrontSdk     from '@aws-sdk/client-cloudfront';
import type * as S3Sdk             from '@aws-sdk/client-s3';
import { mockClient }              from 'aws-sdk-client-mock';
import type { AwsClientStub }      from 'aws-sdk-client-mock';

import { captureCfnResponse }      from '../../../runtime-test-support';
import type { SmokeTestProbe }     from '../../../runtime/handler-kit/smoke-test';
import type * as HandlerModule     from '../handler';

import {
  PHYSICAL_RESOURCE_ID,
  dataSource,
  fakeCreateEvent,
  fakeLambdaContext,
  fakeUpdateEvent,
} from './content-deployer-helpers';
import type { FakeCfnEvent } from './content-deployer-helpers';

jest.mock('https', () => ({
  request: jest.fn(),
}));

/** The faked AWS clients of one loaded handler, with the SDK modules whose command classes they answer. */
interface Fakes {
  s3:                AwsClientStub<S3Sdk.S3Client>;
  cloudFormation:    AwsClientStub<CloudFormationSdk.CloudFormationClient>;
  cloudFront:        AwsClientStub<CloudFrontSdk.CloudFrontClient>;
  s3Sdk:             typeof S3Sdk;
  cloudFormationSdk: typeof CloudFormationSdk;
  cloudFrontSdk:     typeof CloudFrontSdk;
}

const GOOD_ENVIRONMENT = { SERVICE_NAME: 'content-deployer' };
const BAD_ENVIRONMENT  = { SERVICE_NAME: 'content-deployer', LOG_LEVEL: 'verbose' };

describe('content-deployer handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  /**
   * Loads the handler fresh under the given environment with S3 and CloudFormation faked, lets the test
   * arrange the fakes, then invokes the handler and captures the response it sends to CloudFormation.
   */
  async function invoke(
    event: FakeCfnEvent | SmokeTestProbe,
    environment: Record<string, string>,
    arrange: (fakes: Fakes) => void = () => undefined,
    remainingMs: number = 300_000,
  ) {
    jest.resetModules();
    process.env = { ...originalEnv, ...environment };

    // Required after resetModules so the faked client classes are the ones the handler constructs.
    const s3Sdk             = require('@aws-sdk/client-s3') as typeof S3Sdk;
    const cloudFormationSdk = require('@aws-sdk/client-cloudformation') as typeof CloudFormationSdk;
    const cloudFrontSdk     = require('@aws-sdk/client-cloudfront') as typeof CloudFrontSdk;
    const fakes: Fakes      = {
      s3:             mockClient(s3Sdk.S3Client),
      cloudFormation: mockClient(cloudFormationSdk.CloudFormationClient),
      cloudFront:     mockClient(cloudFrontSdk.CloudFrontClient),
      s3Sdk,
      cloudFormationSdk,
      cloudFrontSdk,
    };
    arrange(fakes);

    const readResponse = captureCfnResponse();

    const { handler } = require('../handler') as typeof HandlerModule;
    const result      = await handler(event, fakeLambdaContext(remainingMs));

    return {
      result,
      get response() {
        return readResponse();
      },
      fakes,
    };
  }

  it('reports the smoke-test probe unhealthy when the configuration is bad', async () => {
    const { result } = await invoke({ serverlessInboxSmokeTest: true }, BAD_ENVIRONMENT);

    expect(result).toEqual({ serverlessInboxSmokeTestOk: false });
  });

  it('answers FAILED naming the variable when the configuration is bad', async () => {
    const { response } = await invoke(fakeCreateEvent({ sources: [] }), BAD_ENVIRONMENT);

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('LOG_LEVEL');
  });

  it('emits the trace at the configured log level as it happens', async () => {
    await invoke(
      fakeCreateEvent({ sources: [] }),
      { ...GOOD_ENVIRONMENT, LOG_LEVEL: 'debug' },
    );

    expect(console.debug).toHaveBeenCalledWith('CustomResource event received', {
      requestType: 'Create',
      service:     'content-deployer',
    });
  });

  it('emits the manual-finalize hint under the configured service name', async () => {
    await invoke(fakeCreateEvent({ sources: [] }), GOOD_ENVIRONMENT);

    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^MANUAL_FINALIZE .* service=content-deployer$/));
  });

  it('answers FAILED and flushes the buffered trace when a write fails unexpectedly', async () => {
    const { response } = await invoke(
      fakeCreateEvent({ targetBucket: 'my-bucket', sources: [dataSource()] }),
      GOOD_ENVIRONMENT,
      (arranged) => arranged.s3.on(arranged.s3Sdk.PutObjectCommand).rejects(new Error('AccessDenied')),
    );

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('AccessDenied');
    expect(console.debug).toHaveBeenCalledWith('CustomResource event received', {
      requestType: 'Create',
      service:     'content-deployer',
    });
  });

  it('answers FAILED without flushing the buffered trace when the failure is an expected one', async () => {
    const { response } = await invoke(
      fakeCreateEvent({ targetBucket: 'my-bucket', sources: [dataSource()] }),
      GOOD_ENVIRONMENT,
      (arranged) => arranged.s3.on(arranged.s3Sdk.PutObjectCommand).resolves({}),
      30_000,
    );

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('before the Lambda deadline');
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('answers SUCCESS to an Update that fails while the parent stack rolls back', async () => {
    const { response } = await invoke(
      fakeUpdateEvent({ sources: 'not-an-array' }),
      GOOD_ENVIRONMENT,
      (arranged) =>
        arranged.cloudFormation.on(arranged.cloudFormationSdk.DescribeStacksCommand).resolves({
          Stacks: [{ StackName: 'parent', CreationTime: new Date(), StackStatus: 'UPDATE_ROLLBACK_IN_PROGRESS' }],
        }),
    );

    expect(response.Status).toBe('SUCCESS');
    expect(response.PhysicalResourceId).toBe(PHYSICAL_RESOURCE_ID);
  });
});
