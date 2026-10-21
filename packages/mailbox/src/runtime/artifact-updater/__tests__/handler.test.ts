/// <reference types="jest" />

/**
 * Pins what the handler file decides: which trigger an event belongs to, how each trigger is answered when the
 * configuration is bad (FAILED to CloudFormation but SUCCESS on Delete so a stack in DELETE_FAILED can still be
 * deleted, a 500 to the HTTP API, a throw to a scheduled run), and that the buffered trace is flushed when an
 * invocation fails unexpectedly and not otherwise. The handler is loaded fresh under each environment, with the
 * AWS clients it builds faked and CloudFormation's response read from the request sent to the ResponseURL.
 */

import type * as LambdaSdk                                        from '@aws-sdk/client-lambda';
import type * as TaggingSdk                                       from '@aws-sdk/client-resource-groups-tagging-api';
import type * as LambdaRuntime                                    from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                             from 'aws-sdk-client-mock';
import type { AwsClientStub }                                     from 'aws-sdk-client-mock';
import type * as Https                                            from 'https';
import { Writable }                                               from 'stream';

import type * as HandlerModule                                    from '../handler';

import { deployEndTriggerEvent, fakeLambdaContext, httpApiEvent } from './updater-helpers';

jest.mock('https', () => ({
  request: jest.fn(),
}));

jest.mock('@serverlessinbox/artifact-registry', () => ({
  deriveTrack: jest.fn(),
  buildArtifactKey: jest.fn(),
  readReleasePointer: jest.fn(),
}));

interface CfnResponseBody {
  Status: string;
  Reason?: string;
  PhysicalResourceId?: string;
}

/** The faked AWS clients of one loaded handler, with the SDK modules whose command classes they answer. */
interface Fakes {
  tagging: AwsClientStub<TaggingSdk.ResourceGroupsTaggingAPIClient>;
  lambda: AwsClientStub<LambdaSdk.LambdaClient>;
  taggingSdk: typeof TaggingSdk;
  lambdaSdk: typeof LambdaSdk;
  lambdaRuntime: typeof LambdaRuntime;
}

const GOOD_ENVIRONMENT = {
  SERVICE_NAME: 'artifact-updater',
  AWS_REGION: 'us-east-1',
  AWS_LAMBDA_FUNCTION_NAME: 'artifact-updater-function',
  PROJECT: 'serverlessinbox',
  DIST_TAG: 'latest',
  GRANULARITY: 'major',
  ARTIFACT_BUCKET_BASE: 'mailbox-artifacts',
  ROOT_STACK_TAG_VALUE: 'my-stack',
  ROOT_STACK_ID: 'guid-1',
};
const BAD_ENVIRONMENT  = { ...GOOD_ENVIRONMENT, LOG_LEVEL: 'verbose' };

describe('artifact-updater handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  /**
   * Loads the handler fresh under the given environment with tagging and Lambda faked, lets the test arrange the
   * fakes, then invokes the handler. Returns what it resolved with, what it threw, and the response it sent to
   * CloudFormation.
   */
  async function invoke(
    event: unknown,
    environment: Record<string, string>,
    arrange: (fakes: Fakes) => void = () => undefined,
  ) {
    jest.resetModules();
    process.env = { ...originalEnv, ...environment };

    // Required after resetModules so the faked client classes are the ones the handler constructs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const taggingSdk = require('@aws-sdk/client-resource-groups-tagging-api') as typeof TaggingSdk;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lambdaSdk = require('@aws-sdk/client-lambda') as typeof LambdaSdk;
    // The handler's `instanceof ExpectedFailure` sees the class of its own module registry, so the test takes it from the same one.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lambdaRuntime = require('@serverlessinbox/mailbox-cdk-shared/lambda-runtime') as typeof LambdaRuntime;
    const fakes: Fakes  = {
      tagging: mockClient(taggingSdk.ResourceGroupsTaggingAPIClient),
      lambda: mockClient(lambdaSdk.LambdaClient),
      taggingSdk,
      lambdaSdk,
      lambdaRuntime,
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
    const { handler }                               = require('../handler') as typeof HandlerModule;
    let result: Awaited<ReturnType<typeof handler>> = undefined;
    let failure: unknown;
    try {
      result = await handler(event, fakeLambdaContext());
    } catch (thrown) {
      failure = thrown;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response: CfnResponseBody = responseJson === '' ? { Status: 'NOT SENT' } : JSON.parse(responseJson);
    return { result, failure, response, fakes };
  }

  function tracedStart() {
    return ['artifact update cycle started', expect.objectContaining({ rootStackTag: 'my-stack' })] as const;
  }

  describe('dispatch', () => {
    it.each([
      ['a CloudFormation request', deployEndTriggerEvent('Delete'), 'cfn-custom-resource'],
      ['an HTTP API request', httpApiEvent('GET', '/other'), 'http-api'],
      ['any other event', {}, 'eventbridge-or-self-invoke'],
    ])('logs which trigger fired for %s', async (_description, event, mode) => {
      await invoke(event, GOOD_ENVIRONMENT, (fakes) =>
        fakes.tagging.on(fakes.taggingSdk.GetResourcesCommand).resolves({ ResourceTagMappingList: [] }),
      );

      expect(console.info).toHaveBeenCalledWith('artifact-updater dispatch', { mode });
    });
  });

  describe('a CloudFormation request', () => {
    it('is answered FAILED naming the variable when the configuration is bad', async () => {
      const { response, failure, result } = await invoke(deployEndTriggerEvent('Create'), BAD_ENVIRONMENT);

      expect(failure).toBeUndefined();
      expect(result).toBeUndefined();
      expect(response.Status).toBe('FAILED');
      expect(response.Reason).toContain('LOG_LEVEL');
    });

    it('is answered SUCCESS to a Delete when the configuration is bad, and the error is logged', async () => {
      const { response } = await invoke(deployEndTriggerEvent('Delete'), BAD_ENVIRONMENT);

      expect(response.Status).toBe('SUCCESS');
      expect(response.PhysicalResourceId).toBe('deploy-end-physical-id');
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Configuration error on Delete'), {
        error: expect.stringContaining('LOG_LEVEL'),
      });
    });

    it('is answered SUCCESS to a Delete with the physical id CloudFormation sent, without running the cycle', async () => {
      const { response, fakes } = await invoke(deployEndTriggerEvent('Delete'), GOOD_ENVIRONMENT);

      expect(response.Status).toBe('SUCCESS');
      expect(response.PhysicalResourceId).toBe('deploy-end-physical-id');
      expect(fakes.tagging.calls()).toHaveLength(0);
    });

    it('emits the manual-finalize hint under the configured service name', async () => {
      await invoke(deployEndTriggerEvent('Delete'), GOOD_ENVIRONMENT);

      expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^MANUAL_FINALIZE .* service=artifact-updater$/));
    });

    it('runs the update cycle and is answered SUCCESS, flushing nothing', async () => {
      const { response, fakes } = await invoke(deployEndTriggerEvent('Create'), GOOD_ENVIRONMENT, (arranged) =>
        arranged.tagging.on(arranged.taggingSdk.GetResourcesCommand).resolves({ ResourceTagMappingList: [] }),
      );

      expect(fakes.tagging.commandCalls(fakes.taggingSdk.GetResourcesCommand)).toHaveLength(2);
      expect(response.Status).toBe('SUCCESS');
      expect(console.info).not.toHaveBeenCalledWith(...tracedStart());
    });

    it('is answered SUCCESS and flushes the buffered trace when the update cycle fails', async () => {
      const { response, failure, result } = await invoke(deployEndTriggerEvent('Create'), GOOD_ENVIRONMENT, (arranged) =>
        arranged.tagging.on(arranged.taggingSdk.GetResourcesCommand).rejects(new Error('ThrottlingException')),
      );

      expect(failure).toBeUndefined();
      expect(result).toBeUndefined();
      expect(response.Status).toBe('SUCCESS');
      expect(console.info).toHaveBeenCalledWith(...tracedStart());
    });
  });

  describe('an HTTP API request', () => {
    it('is answered 500 naming the variable when the configuration is bad', async () => {
      const { result } = await invoke(httpApiEvent('POST', '/artifact-updates/trigger'), BAD_ENVIRONMENT);

      expect(result).toMatchObject({ statusCode: 500, body: expect.stringContaining('LOG_LEVEL') });
      expect(console.error).toHaveBeenCalledWith('Configuration error', { error: expect.stringContaining('LOG_LEVEL') });
    });

    it('is answered 404, and no update cycle runs, when its request context names no method and path', async () => {
      const { result, fakes } = await invoke({ requestContext: {} }, GOOD_ENVIRONMENT);

      expect(result).toEqual({ statusCode: 404, body: '' });
      expect(fakes.tagging.calls()).toHaveLength(0);
    });

    it('is answered 202 when the update is started', async () => {
      const { result, fakes } = await invoke(httpApiEvent('POST', '/artifact-updates/trigger'), GOOD_ENVIRONMENT, (arranged) =>
        arranged.lambda.on(arranged.lambdaSdk.InvokeCommand).resolves({}),
      );

      expect(result).toMatchObject({ statusCode: 202 });
      expect(fakes.lambda.commandCalls(fakes.lambdaSdk.InvokeCommand)[0].args[0].input.FunctionName).toBe(
        'artifact-updater-function',
      );
      expect(console.debug).not.toHaveBeenCalled();
    });

    it('is answered 500 and flushes the buffered trace when the update cannot be started', async () => {
      const { result } = await invoke(httpApiEvent('POST', '/artifact-updates/trigger'), GOOD_ENVIRONMENT, (arranged) =>
        arranged.lambda.on(arranged.lambdaSdk.InvokeCommand).rejects(new Error('AccessDeniedException')),
      );

      expect(result).toMatchObject({ statusCode: 500, body: expect.stringContaining('AccessDeniedException') });
      expect(console.debug).toHaveBeenCalledWith('http trigger received', {
        method: 'POST',
        path: '/artifact-updates/trigger',
        service: 'artifact-updater',
      });
    });
  });

  describe('any other event', () => {
    it('is rejected naming the variable when the configuration is bad', async () => {
      const { failure } = await invoke({}, BAD_ENVIRONMENT);

      expect(failure).toMatchObject({ message: expect.stringContaining('LOG_LEVEL') });
    });

    it('runs the update cycle and flushes nothing when it succeeds', async () => {
      const { failure, fakes } = await invoke({}, GOOD_ENVIRONMENT, (arranged) =>
        arranged.tagging.on(arranged.taggingSdk.GetResourcesCommand).resolves({ ResourceTagMappingList: [] }),
      );

      expect(failure).toBeUndefined();
      expect(fakes.tagging.commandCalls(fakes.taggingSdk.GetResourcesCommand)).toHaveLength(2);
      expect(console.info).not.toHaveBeenCalledWith(...tracedStart());
    });

    it('rejects with the failure and flushes the buffered trace when the update cycle fails', async () => {
      const { failure } = await invoke({}, GOOD_ENVIRONMENT, (arranged) =>
        arranged.tagging.on(arranged.taggingSdk.GetResourcesCommand).rejects(new Error('ThrottlingException')),
      );

      expect(failure).toEqual(new Error('ThrottlingException'));
      expect(console.info).toHaveBeenCalledWith(...tracedStart());
    });

    it('rejects with an expected failure and flushes nothing', async () => {
      let expected: Error | undefined;
      const { failure } = await invoke({}, GOOD_ENVIRONMENT, (arranged) => {
        expected = new arranged.lambdaRuntime.ExpectedFailure('no release published');
        arranged.tagging.on(arranged.taggingSdk.GetResourcesCommand).rejects(expected);
      });

      expect(failure).toBe(expected);
      expect(console.info).not.toHaveBeenCalledWith(...tracedStart());
    });
  });
});
