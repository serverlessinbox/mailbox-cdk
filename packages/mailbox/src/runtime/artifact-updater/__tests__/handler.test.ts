/// <reference types="jest" />

/**
 * Pins what the handler file decides: which trigger an event is routed to, and that the buffered trace is flushed
 * exactly when an invocation fails unexpectedly and not otherwise. The answer each trigger gives, and the answer to a
 * bad configuration, are pinned by that trigger's own suite. The handler is loaded fresh under each environment, with
 * the AWS clients it builds faked and CloudFormation's response read from the request sent to the ResponseURL.
 */

import type * as LambdaSdk                                                          from '@aws-sdk/client-lambda';
import type * as TaggingSdk                                                         from '@aws-sdk/client-resource-groups-tagging-api';
import type * as LambdaRuntime                                                      from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                                               from 'aws-sdk-client-mock';
import type { AwsClientStub }                                                       from 'aws-sdk-client-mock';
import type * as Https                                                              from 'https';
import { Writable }                                                                 from 'stream';
import * as t                                                                       from 'typanion';

import type * as HandlerModule                                                      from '../handler';

import {
  deployEndTriggerEvent,
  fakeLambdaContext,
  GOOD_ENVIRONMENT as SHARED_ENVIRONMENT,
  httpApiEvent,
} from './updater-helpers';

jest.mock('https', () => ({
  request: jest.fn(),
}));

jest.mock('@serverlessinbox/artifact-registry', () =>
  (jest.requireActual('./updater-helpers') as typeof import('./updater-helpers')).artifactRegistryModuleMock(),
);

/** The deployment region is the edge region here, so one scan of the tagging API covers the cycle. */
const GOOD_ENVIRONMENT = { ...SHARED_ENVIRONMENT, AWS_REGION: 'us-east-1' };

const isCfnResponseBody = t.isPartial({
  Status:             t.isString(),
  Reason:             t.isOptional(t.isString()),
  PhysicalResourceId: t.isOptional(t.isString()),
});

/** The fields of the body the handler PUTs to the ResponseURL that these tests assert on. */
type CfnResponseBody = t.InferType<typeof isCfnResponseBody>;

/** The faked AWS clients of one loaded handler, with the SDK modules whose command classes they answer. */
interface Fakes {
  tagging:       AwsClientStub<TaggingSdk.ResourceGroupsTaggingAPIClient>;
  lambda:        AwsClientStub<LambdaSdk.LambdaClient>;
  taggingSdk:    typeof TaggingSdk;
  lambdaSdk:     typeof LambdaSdk;
  lambdaRuntime: typeof LambdaRuntime;
}

function parseCfnResponse(json: string): CfnResponseBody {
  const parsed: unknown = JSON.parse(json);
  t.assert(parsed, isCfnResponseBody);
  return parsed;
}

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
    const taggingSdk = require('@aws-sdk/client-resource-groups-tagging-api') as typeof TaggingSdk;
    const lambdaSdk  = require('@aws-sdk/client-lambda') as typeof LambdaSdk;
    // The handler's `instanceof ExpectedFailure` sees the class of its own module registry, so the test takes it from the same one.
    const lambdaRuntime = require('@serverlessinbox/mailbox-cdk-shared/lambda-runtime') as typeof LambdaRuntime;
    const fakes: Fakes  = {
      tagging: mockClient(taggingSdk.ResourceGroupsTaggingAPIClient),
      lambda:  mockClient(lambdaSdk.LambdaClient),
      taggingSdk,
      lambdaSdk,
      lambdaRuntime,
    };
    arrange(fakes);

    let responseJson = '';
    const https      = require('https') as typeof Https;
    jest.mocked(https.request).mockImplementation(((_options: unknown, callback: (res: object) => void) => {
      callback({ statusCode: 200 });
      return new Writable({
        write(chunk: Buffer, _encoding, done) {
          responseJson += chunk.toString();
          done();
        },
      });
    }) as typeof https.request);

    const { handler }                               = require('../handler') as typeof HandlerModule;
    let result: Awaited<ReturnType<typeof handler>> = undefined;
    let failure: unknown;
    try {
      result = await handler(event, fakeLambdaContext());
    } catch (thrown) {
      failure = thrown;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response: CfnResponseBody = responseJson === '' ? { Status: 'NOT SENT' } : parseCfnResponse(responseJson);
    return { result, failure, response, fakes };
  }

  function tracedStart() {
    return ['artifact update cycle started', expect.objectContaining({ rootStackTag: 'my-stack' })] as const;
  }

  describe('routing', () => {
    it('routes a CloudFormation Delete to the deploy-end trigger, which answers without running the cycle', async () => {
      const { response, fakes } = await invoke(deployEndTriggerEvent('Delete'), GOOD_ENVIRONMENT);

      expect(response.Status).toBe('SUCCESS');
      expect(fakes.tagging.calls()).toHaveLength(0);
    });

    it('routes an HTTP API trigger request to the HTTP trigger, which starts the update and answers 202', async () => {
      const { result } = await invoke(httpApiEvent('POST', '/artifact-updates/trigger'), GOOD_ENVIRONMENT, (arranged) =>
        arranged.lambda.on(arranged.lambdaSdk.InvokeCommand).resolves({}),
      );

      expect(result).toMatchObject({ statusCode: 202 });
    });

    it('routes any other event to the scheduled trigger, which runs the update cycle', async () => {
      const { fakes } = await invoke({}, GOOD_ENVIRONMENT, (arranged) =>
        arranged.tagging.on(arranged.taggingSdk.GetResourcesCommand).resolves({ ResourceTagMappingList: [] }),
      );

      expect(fakes.tagging.commandCalls(fakes.taggingSdk.GetResourcesCommand)).toHaveLength(2);
    });
  });

  describe('flushing the buffered trace', () => {
    it('flushes it when a CloudFormation request fails unexpectedly in the update cycle', async () => {
      await invoke(deployEndTriggerEvent('Create'), GOOD_ENVIRONMENT, (arranged) =>
        arranged.tagging.on(arranged.taggingSdk.GetResourcesCommand).rejects(new Error('ThrottlingException')),
      );

      expect(console.info).toHaveBeenCalledWith(...tracedStart());
    });

    it('flushes it when an HTTP API request cannot start the update', async () => {
      await invoke(httpApiEvent('POST', '/artifact-updates/trigger'), GOOD_ENVIRONMENT, (arranged) =>
        arranged.lambda.on(arranged.lambdaSdk.InvokeCommand).rejects(new Error('AccessDeniedException')),
      );

      expect(console.debug).toHaveBeenCalledWith('http trigger received', {
        method:  'POST',
        path:    '/artifact-updates/trigger',
        service: 'artifact-updater',
      });
    });

    it('rejects with the failure and flushes the buffered trace when an other event fails unexpectedly', async () => {
      const { failure } = await invoke({}, GOOD_ENVIRONMENT, (arranged) =>
        arranged.tagging.on(arranged.taggingSdk.GetResourcesCommand).rejects(new Error('ThrottlingException')),
      );

      expect(failure).toEqual(new Error('ThrottlingException'));
      expect(console.info).toHaveBeenCalledWith(...tracedStart());
    });

    it('flushes nothing when an other event succeeds', async () => {
      const { failure } = await invoke({}, GOOD_ENVIRONMENT, (arranged) =>
        arranged.tagging.on(arranged.taggingSdk.GetResourcesCommand).resolves({ ResourceTagMappingList: [] }),
      );

      expect(failure).toBeUndefined();
      expect(console.info).not.toHaveBeenCalledWith(...tracedStart());
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
