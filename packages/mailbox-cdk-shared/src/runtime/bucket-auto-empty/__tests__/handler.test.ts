/// <reference types="jest" />

/**
 * Pins what the bucket-auto-empty handler file decides: a bad configuration is answered to CloudFormation
 * (FAILED, but SUCCESS on Delete so a stack in DELETE_FAILED can still be deleted), the buffered trace is
 * flushed only for an unexpected error, and a failed Update during a rollback is answered SUCCESS. The
 * response is read from the request the handler sends to the ResponseURL.
 */

import type * as CloudFormationSdk                                                                    from '@aws-sdk/client-cloudformation';
import type * as S3Sdk                                                                                from '@aws-sdk/client-s3';
import { mockClient }                                                                                 from 'aws-sdk-client-mock';
import type { AwsClientStub }                                                                         from 'aws-sdk-client-mock';
import type * as Https                                                                                from 'https';
import { Writable }                                                                                   from 'stream';
import * as t                                                                                         from 'typanion';

import type { SmokeTestProbe }                                                                        from '../../../runtime/handler-kit/smoke-test';
import type * as HandlerModule                                                                        from '../handler';

import { fakeCreateEvent, fakeDeleteEvent, fakeLambdaContext, fakeUpdateEvent, PHYSICAL_RESOURCE_ID } from './bucket-auto-empty-helpers';
import type { FakeCfnEvent }                                                                          from './bucket-auto-empty-helpers';

jest.mock('https', () => ({
  request: jest.fn(),
}));

const isCfnResponseBody = t.isPartial({
  Status: t.isString(),
  Reason: t.isOptional(t.isString()),
  PhysicalResourceId: t.isOptional(t.isString()),
  Data: t.isOptional(t.isRecord(t.isString())),
});

/** The body the handler PUTs to the ResponseURL, or `NOT SENT` when it sent none. */
type CfnResponseBody = t.InferType<typeof isCfnResponseBody>;

/** The faked AWS clients of one loaded handler, with the SDK modules whose command classes they answer. */
interface Fakes {
  s3: AwsClientStub<S3Sdk.S3Client>;
  cloudFormation: AwsClientStub<CloudFormationSdk.CloudFormationClient>;
  s3Sdk: typeof S3Sdk;
  cloudFormationSdk: typeof CloudFormationSdk;
}

const GOOD_ENVIRONMENT = { SERVICE_NAME: 'bucket-auto-empty' };
const BAD_ENVIRONMENT  = { SERVICE_NAME: 'bucket-auto-empty', LOG_LEVEL: 'verbose' };

describe('bucket-auto-empty handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
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
    const fakes: Fakes      = {
      s3: mockClient(s3Sdk.S3Client),
      cloudFormation: mockClient(cloudFormationSdk.CloudFormationClient),
      s3Sdk,
      cloudFormationSdk,
    };
    arrange(fakes);

    let responseJson = '';
    const https      = require('https') as typeof Https;
    jest.mocked(https.request).mockImplementation(((...[, onResponse]: [unknown, (res: object) => void]) => {
      onResponse({ statusCode: 200 });
      return new Writable({
        write(...[chunk, , done]: [Buffer, BufferEncoding, (error?: Error | null) => void]) {
          responseJson += chunk.toString();
          done();
        },
      });
    }) as typeof https.request);

    const { handler } = require('../handler') as typeof HandlerModule;
    const result      = await handler(event, fakeLambdaContext(remainingMs));
    await new Promise((resolve) => setTimeout(resolve, 50));

    let response: CfnResponseBody = { Status: 'NOT SENT' };
    if (responseJson !== '') {
      const sent: unknown = JSON.parse(responseJson);
      t.assert(sent, isCfnResponseBody);
      response = sent;
    }
    return { result, response, fakes };
  }

  function bucketHolds(fakes: Fakes, keys: string[]): void {
    fakes.s3.on(fakes.s3Sdk.ListObjectVersionsCommand).resolves({
      Versions: keys.map((key) => ({ Key: key, VersionId: `${key}-v1` })),
      IsTruncated: false,
    });
    fakes.s3.on(fakes.s3Sdk.DeleteObjectsCommand).resolves({});
  }

  it('reports the smoke-test probe unhealthy when the configuration is bad', async () => {
    const { result } = await invoke({ serverlessInboxSmokeTest: true }, BAD_ENVIRONMENT);

    expect(result).toEqual({ serverlessInboxSmokeTestOk: false });
  });

  it('answers FAILED naming the variable when the configuration is bad', async () => {
    const { response } = await invoke(fakeCreateEvent({ bucketName: 'my-bucket' }), BAD_ENVIRONMENT);

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('LOG_LEVEL');
  });

  it('answers SUCCESS to Delete when the configuration is bad, and logs the configuration error', async () => {
    const { response, fakes } = await invoke(fakeDeleteEvent({ bucketName: 'my-bucket' }), BAD_ENVIRONMENT);

    expect(response.Status).toBe('SUCCESS');
    expect(response.PhysicalResourceId).toBe(PHYSICAL_RESOURCE_ID);
    const loggedConfigError: unknown = expect.stringContaining('LOG_LEVEL');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Configuration error on Delete'), {
      error: loggedConfigError,
    });
    expect(fakes.s3.calls()).toHaveLength(0);
  });

  it('empties the bucket on Delete and flushes nothing', async () => {
    const { response, fakes } = await invoke(
      fakeDeleteEvent({ bucketName: 'my-bucket' }),
      GOOD_ENVIRONMENT,
      (arranged) => bucketHolds(arranged, ['a.txt', 'b.txt']),
    );

    expect(response).toMatchObject({ Status: 'SUCCESS', Data: { deleted: '2' } });
    expect(fakes.s3.commandCalls(fakes.s3Sdk.DeleteObjectsCommand)).toHaveLength(1);
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('answers a Delete SUCCESS with nothing deleted when the bucket no longer exists', async () => {
    const { response } = await invoke(
      fakeDeleteEvent({ bucketName: 'gone-bucket' }),
      GOOD_ENVIRONMENT,
      (arranged) =>
        arranged.s3.on(arranged.s3Sdk.ListObjectVersionsCommand).rejects(
          new arranged.s3Sdk.NoSuchBucket({ message: 'The specified bucket does not exist', $metadata: {} }),
        ),
    );

    expect(response).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: PHYSICAL_RESOURCE_ID, Data: { deleted: '0' } });
  });

  it('answers a Delete SUCCESS with nothing deleted when the bucket is already empty', async () => {
    const { response, fakes } = await invoke(
      fakeDeleteEvent({ bucketName: 'my-bucket' }),
      GOOD_ENVIRONMENT,
      (arranged) => bucketHolds(arranged, []),
    );

    expect(response).toMatchObject({ Status: 'SUCCESS', Data: { deleted: '0' } });
    expect(fakes.s3.commandCalls(fakes.s3Sdk.DeleteObjectsCommand)).toHaveLength(0);
  });

  it('answers a Delete FAILED saying the bucket cannot be checked when it names no bucket', async () => {
    const { response, fakes } = await invoke(fakeDeleteEvent({}), GOOD_ENVIRONMENT);

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('Cannot check the bucket');
    expect(fakes.s3.calls()).toHaveLength(0);
  });

  it('answers a Delete FAILED with the reason, and sends the answer, when the invocation is nearly out of time', async () => {
    const { response, fakes } = await invoke(
      fakeDeleteEvent({ bucketName: 'my-bucket' }),
      GOOD_ENVIRONMENT,
      (arranged) => bucketHolds(arranged, ['a.txt']),
      30_000,
    );

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('was not fully emptied before the Lambda deadline (0 items deleted so far)');
    expect(fakes.s3.calls()).toHaveLength(0);
  });

  it('emits the manual-finalize hint under the configured service name', async () => {
    await invoke(
      fakeDeleteEvent({ bucketName: 'my-bucket' }),
      GOOD_ENVIRONMENT,
      (arranged) => bucketHolds(arranged, []),
    );

    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^MANUAL_FINALIZE .* service=bucket-auto-empty$/));
  });

  it('answers FAILED and flushes the buffered trace when emptying the bucket fails unexpectedly', async () => {
    const { response } = await invoke(
      fakeDeleteEvent({ bucketName: 'my-bucket' }),
      GOOD_ENVIRONMENT,
      (arranged) => arranged.s3.on(arranged.s3Sdk.ListObjectVersionsCommand).rejects(new Error('AccessDenied')),
    );

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('AccessDenied');
    expect(console.debug).toHaveBeenCalledWith('CustomResource event received', {
      requestType: 'Delete',
      service: 'bucket-auto-empty',
    });
  });

  it('answers FAILED without flushing when the request is rejected on purpose', async () => {
    const { response } = await invoke(fakeCreateEvent({ bucketName: 123 }), GOOD_ENVIRONMENT);

    expect(response.Status).toBe('FAILED');
    expect(response.Reason).toContain('Invalid ResourceProperties');
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('answers SUCCESS to an Update that fails while the parent stack rolls back', async () => {
    const { response } = await invoke(
      fakeUpdateEvent({ bucketName: 123 }),
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
