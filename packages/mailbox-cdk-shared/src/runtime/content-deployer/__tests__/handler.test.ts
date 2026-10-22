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
import type * as Https             from 'https';
import { Writable }                from 'stream';

import type { SmokeTestProbe }     from '../../../runtime/handler-kit/smoke-test';
import type * as HandlerModule     from '../handler';

import {
  PHYSICAL_RESOURCE_ID,
  dataSource,
  fakeCreateEvent,
  fakeDeleteEvent,
  fakeLambdaContext,
  fakeUpdateEvent,
} from './content-deployer-helpers';
import type { FakeCfnEvent } from './content-deployer-helpers';

jest.mock('https', () => ({
  request: jest.fn(),
}));

interface CfnResponseBody {
  Status: string;
  Reason?: string;
  PhysicalResourceId?: string;
  Data?: Record<string, string>;
}

/** The faked AWS clients of one loaded handler, with the SDK modules whose command classes they answer. */
interface Fakes {
  s3: AwsClientStub<S3Sdk.S3Client>;
  cloudFormation: AwsClientStub<CloudFormationSdk.CloudFormationClient>;
  cloudFront: AwsClientStub<CloudFrontSdk.CloudFrontClient>;
  s3Sdk: typeof S3Sdk;
  cloudFormationSdk: typeof CloudFormationSdk;
  cloudFrontSdk: typeof CloudFrontSdk;
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
  ) {
    jest.resetModules();
    process.env = { ...originalEnv, ...environment };

    // Required after resetModules so the faked client classes are the ones the handler constructs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const s3Sdk = require('@aws-sdk/client-s3') as typeof S3Sdk;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cloudFormationSdk = require('@aws-sdk/client-cloudformation') as typeof CloudFormationSdk;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cloudFrontSdk = require('@aws-sdk/client-cloudfront') as typeof CloudFrontSdk;
    const fakes: Fakes  = {
      s3: mockClient(s3Sdk.S3Client),
      cloudFormation: mockClient(cloudFormationSdk.CloudFormationClient),
      cloudFront: mockClient(cloudFrontSdk.CloudFrontClient),
      s3Sdk,
      cloudFormationSdk,
      cloudFrontSdk,
    };
    arrange(fakes);

    let responseJson = '';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https') as typeof Https;
    jest.mocked(https.request).mockImplementation(((_options: unknown, callback: (res: object) => void) => {
      callback({ statusCode: 200 });
      return new Writable({
        write(chunk: Buffer, _encoding, done) {
          responseJson += chunk.toString();
          done();
        },
      });
    }) as typeof https.request);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { handler } = require('../handler') as typeof HandlerModule;
    const result      = await handler(event, fakeLambdaContext());
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response: CfnResponseBody = responseJson === '' ? { Status: 'NOT SENT' } : JSON.parse(responseJson);
    return { result, response, fakes };
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

  it('answers SUCCESS to Delete when the configuration is bad, and logs the configuration error', async () => {
    const { response, fakes } = await invoke(fakeDeleteEvent({ sources: [] }), BAD_ENVIRONMENT);

    expect(response.Status).toBe('SUCCESS');
    expect(response.PhysicalResourceId).toBe(PHYSICAL_RESOURCE_ID);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Configuration error on Delete'), {
      error: expect.stringContaining('LOG_LEVEL'),
    });
    expect(fakes.s3.calls()).toHaveLength(0);
  });

  it('deploys the sources and flushes nothing', async () => {
    const { response, fakes } = await invoke(
      fakeCreateEvent({ targetBucket: 'my-bucket', sources: [dataSource()] }),
      GOOD_ENVIRONMENT,
      (arranged) => arranged.s3.on(arranged.s3Sdk.PutObjectCommand).resolves({}),
    );

    expect(response).toMatchObject({ Status: 'SUCCESS', Data: { objectsWritten: '1' } });
    expect(fakes.s3.commandCalls(fakes.s3Sdk.PutObjectCommand)).toHaveLength(1);
    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it('emits the trace at the configured log level as it happens', async () => {
    await invoke(
      fakeCreateEvent({ sources: [] }),
      { ...GOOD_ENVIRONMENT, LOG_LEVEL: 'debug' },
    );

    expect(console.debug).toHaveBeenCalledWith('CustomResource event received', {
      requestType: 'Create',
      service: 'content-deployer',
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
      service: 'content-deployer',
    });
  });

  it('answers FAILED without flushing when the request is rejected on purpose', async () => {
    const { response } = await invoke(fakeCreateEvent({ sources: 'not-an-array' }), GOOD_ENVIRONMENT);

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('Invalid ResourceProperties');
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
