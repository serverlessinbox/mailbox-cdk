/// <reference types="jest" />
/// <reference types="node" />

/**
 * Pins the wiring of the bootstrap user handler: what a configuration that does not load answers per request
 * kind, what reaches CloudFormation for a request the request handler answers, and when the buffered trace is
 * written. A bad configuration answered with failure on Delete would leave a stack in DELETE_FAILED that can
 * never be fixed.
 */

import { CloudFormationClient }                       from '@aws-sdk/client-cloudformation';
import {
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider';
import { ParentStackStatus, type LoggerBuffer }                                           from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { captureCfnResponse }                                                             from '@serverlessinbox/mailbox-cdk-shared/runtime-test-support';
import type { CloudFormationCustomResourceEvent, Context }                                from 'aws-lambda';
import { mockClient }                                                                     from 'aws-sdk-client-mock';
import * as t                                                                             from 'typanion';

import { PASSWORD_SET_AT_INSTALL_TIME }                                                   from '../bootstrap-user-answers';
import type * as BootstrapUserModule                                                      from '../index';

import { FUNCTION_ARN, PHYSICAL_RESOURCE_ID, STACK_ID, templateProperties }               from './bootstrap-user-helpers';

jest.mock('https', () => ({
  ...jest.requireActual<typeof import('https')>('https'),
  request: jest.fn(),
}));

const isCfnResponse = t.isPartial({
  Status:             t.isEnum(['SUCCESS', 'FAILED']),
  Reason:             t.isOptional(t.isString()),
  Data:               t.isOptional(t.isObject({ temporaryPassword: t.isOptional(t.isString()), failedGroups: t.isOptional(t.isString()) })),
  PhysicalResourceId: t.isString(),
});
type CfnResponse = t.InferType<typeof isCfnResponse>;

const RESPONSE_URL = 'https://cloudformation-custom-resource-response.example.com/response';

const context: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName:                   'bootstrap-user',
  functionVersion:                '$LATEST',
  invokedFunctionArn:             FUNCTION_ARN,
  memoryLimitInMB:                '256',
  awsRequestId:                   'aws-request-id',
  logGroupName:                   '/aws/lambda/bootstrap-user',
  logStreamName:                  'log-stream',
  getRemainingTimeInMillis:       () => 60000,
  done:                           () => undefined,
  fail:                           () => undefined,
  succeed:                        () => undefined,
};

type ResourceProperties = CloudFormationCustomResourceEvent['ResourceProperties'];

/** The event CloudFormation sends for the resource: the request plus the response URL and the keys of the resource. */
function cfnEvent(requestType: 'Create' | 'Update' | 'Delete', resourceProperties: ResourceProperties = templateProperties()): CloudFormationCustomResourceEvent {
  const common = {
    ServiceToken:      FUNCTION_ARN,
    ResponseURL:       RESPONSE_URL,
    StackId:           STACK_ID,
    RequestId:         'request-id-1',
    LogicalResourceId: 'BootstrapUserResource',
    ResourceType:      'Custom::CognitoBootstrapUser',
  };
  switch (requestType) {
    case 'Create':
      return { ...common, RequestType: 'Create', ResourceProperties: resourceProperties };
    case 'Update':
      return {
        ...common,
        RequestType:           'Update',
        PhysicalResourceId:    PHYSICAL_RESOURCE_ID,
        ResourceProperties:    resourceProperties,
        OldResourceProperties: resourceProperties,
      };
    case 'Delete':
      return { ...common, RequestType: 'Delete', PhysicalResourceId: PHYSICAL_RESOURCE_ID, ResourceProperties: resourceProperties };
  }
}

type HandlerOf = typeof BootstrapUserModule.handler;

/**
 * Reads the response the handler under test PUT. Re-captured wherever a handler is loaded: a handler loaded in
 * an isolated module registry sends through that registry's `https`, so its response is read from there.
 */
let readResponse: ReturnType<typeof captureCfnResponse>;

/** Invokes the handler and parses the one response it PUT to CloudFormation. */
async function invoke(invokedHandler: HandlerOf, event: CloudFormationCustomResourceEvent): Promise<CfnResponse> {
  await invokedHandler(event, context).catch(() => undefined);
  const body: unknown    = readResponse();
  const errors: string[] = [];
  if (!isCfnResponse(body, { errors })) {
    throw new Error(`Unexpected CloudFormation response body: ${errors.join('; ')}`);
  }
  return body;
}

/**
 * The handler as a cold start loads it under the environment `prepare` sets; the caller restores the environment.
 * The handler reads its configuration when it is loaded, so every variable it needs is set before the load.
 */
function loadHandlerWith(prepare: () => void): HandlerOf {
  prepare();
  let loaded: HandlerOf | undefined;
  jest.isolateModules(() => {
    readResponse = captureCfnResponse();
    loaded       = jest.requireActual<{ handler: HandlerOf }>('../index').handler;
  });
  if (loaded === undefined) {
    throw new Error('the handler was not loaded');
  }
  return loaded;
}

/** The handler as a cold start loads it under an environment whose LOG_LEVEL is not a log level. */
function loadHandlerWithBadConfig(): HandlerOf {
  return loadHandlerWith(() => {
    process.env.SERVICE_NAME = 'bootstrap-user';
    process.env.LOG_LEVEL    = 'verbose';
  });
}

/**
 * The handler as a cold start loads it when its request handler logs a debug line and then fails with an
 * `ExpectedFailure`. No failure the real request handler throws follows a buffered line, so this one is staged.
 */
function loadHandlerWhoseRequestHandlerRejectsOnPurpose(): HandlerOf {
  process.env.SERVICE_NAME = 'bootstrap-user';
  let loaded: HandlerOf | undefined;
  jest.isolateModules(() => {
    jest.doMock('../bootstrap-user-request-handler', () => {
      const { ExpectedFailure } = jest.requireActual<typeof import('@serverlessinbox/mailbox-cdk-shared/lambda-runtime')>(
        '@serverlessinbox/mailbox-cdk-shared/lambda-runtime',
      );
      return {
        BootstrapUserRequestHandler: class {
          private readonly logger: LoggerBuffer;

          constructor(_userEnsurer: unknown, logger: LoggerBuffer) {
            this.logger = logger;
          }

          async handle(): Promise<never> {
            this.logger.debug('buffered_before_rejection');
            throw new ExpectedFailure('rejected on purpose');
          }
        },
      };
    });
    readResponse = captureCfnResponse();
    loaded       = jest.requireActual<{ handler: HandlerOf }>('../index').handler;
  });
  if (loaded === undefined) {
    throw new Error('the handler was not loaded');
  }
  return loaded;
}

describe('bootstrap-user handler', () => {
  const cognitoMock        = mockClient(CognitoIdentityProviderClient);
  const cloudFormationMock = mockClient(CloudFormationClient);
  let isRollingBack: jest.SpiedFunction<ParentStackStatus['isRollingBack']>;
  let debugLog: jest.SpyInstance;
  let errorLog: jest.SpiedFunction<typeof console.error>;
  let originalEnvironment: NodeJS.ProcessEnv;

  let handler: HandlerOf;

  beforeAll(() => {
    process.env.SERVICE_NAME = 'bootstrap-user';
    handler                  = jest.requireActual<{ handler: HandlerOf }>('../index').handler;
  });

  /** The first argument of every line written at error level. */
  function loggedErrorMessages(): unknown[] {
    return errorLog.mock.calls.map((call) => call[0] as unknown);
  }

  beforeEach(() => {
    originalEnvironment = { ...process.env };
    readResponse        = captureCfnResponse();
    cognitoMock.reset();
    cloudFormationMock.reset();
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    isRollingBack = jest.spyOn(ParentStackStatus.prototype, 'isRollingBack').mockResolvedValue(false);
    debugLog      = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    errorLog      = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.restoreAllMocks();
  });

  describe('smoke test probe', () => {
    it('answers ok when the configuration loads', async () => {
      expect(await handler({ serverlessInboxSmokeTest: true }, context)).toEqual({ serverlessInboxSmokeTestOk: true });
    });

    it('answers not ok when the configuration does not load', async () => {
      expect(await loadHandlerWithBadConfig()({ serverlessInboxSmokeTest: true }, context)).toEqual({ serverlessInboxSmokeTestOk: false });
    });
  });

  describe('with a configuration that does not load', () => {
    it('answers a Create with FAILED, naming the configuration problem', async () => {
      const response = await invoke(loadHandlerWithBadConfig(), cfnEvent('Create'));

      expect(response.Status).toBe('FAILED');
      expect(response.Reason).toContain('LOG_LEVEL');
    });

    it('answers a Delete with SUCCESS and the marker, under the physical id it came with', async () => {
      const response = await invoke(loadHandlerWithBadConfig(), cfnEvent('Delete'));

      expect(response).toMatchObject({
        Status:             'SUCCESS',
        PhysicalResourceId: PHYSICAL_RESOURCE_ID,
        Data:               { temporaryPassword: PASSWORD_SET_AT_INSTALL_TIME },
      });
    });

  });

  describe('with a configuration that loads', () => {
    it('sends the answer of the request handler to CloudFormation as SUCCESS', async () => {
      const response = await invoke(handler, cfnEvent('Create'));

      expect(response.Status).toBe('SUCCESS');
    });

    it('answers an Update that fails while the parent stack rolls back with SUCCESS and the marker', async () => {
      isRollingBack.mockResolvedValue(true);

      const response = await invoke(handler,cfnEvent('Update', { ServiceToken: FUNCTION_ARN }));

      expect(response).toMatchObject({
        Status:             'SUCCESS',
        PhysicalResourceId: PHYSICAL_RESOURCE_ID,
        Data:               { temporaryPassword: PASSWORD_SET_AT_INSTALL_TIME },
      });
    });

    it('answers an expected failure with FAILED without writing the buffered trace that preceded it', async () => {
      const handlerFailingOnPurpose = loadHandlerWhoseRequestHandlerRejectsOnPurpose();

      const response = await invoke(handlerFailingOnPurpose, cfnEvent('Create'));

      expect(response.Status).toBe('FAILED');
      expect(response.Reason).toContain('rejected on purpose');
      expect(debugLog).not.toHaveBeenCalled();
      expect(loggedErrorMessages()).not.toContain('Handler failed');
    });

    it('answers an unexpected failure with FAILED and writes the buffered trace that led to it', async () => {
      cognitoMock.on(AdminCreateUserCommand).rejects(new NotAuthorizedException({ message: 'denied', $metadata: {} }));

      const response = await invoke(handler,cfnEvent('Create'));

      expect(response.Status).toBe('FAILED');
      expect(debugLog).toHaveBeenCalledWith('bootstrap_user_ensuring_user', { service: 'bootstrap-user' });
      expect(loggedErrorMessages()).toContain('Handler failed');
    });
  });
});
