/// <reference types="jest" />
import { CloudFormationClient }                                                     from '@aws-sdk/client-cloudformation';
import { CloudFrontClient }                                                         from '@aws-sdk/client-cloudfront';
import { LambdaClient, type InvokeCommandOutput }                                   from '@aws-sdk/client-lambda';
import { ResourceGroupsTaggingAPIClient }                                           from '@aws-sdk/client-resource-groups-tagging-api';
import { S3Client }                                                                 from '@aws-sdk/client-s3';
import { LoggerBuffer, toRegion, type Region }                                      from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { APIGatewayProxyEventV2, CloudFormationCustomResourceEvent, Context }  from 'aws-lambda';
import * as https                                                                   from 'https';
import { Writable }                                                                 from 'stream';

import type { LambdaTarget, UiTarget }                                              from '../artifact-target';
import type { Config }                                                              from '../config';
import { EdgeLambdaUpdater }                                                        from '../edge-lambda-updater';
import { FunctionSmokeTester }                                                      from '../lambda-code/function-smoke-tester';
import { LambdaCodeRollback }                                                       from '../lambda-code/lambda-code-rollback';
import { LambdaCodeUpdater }                                                        from '../lambda-code/lambda-code-updater';
import { LambdaFunctionCode, type Sleep }                                           from '../lambda-code/lambda-function-code';
import { ReleaseArtifacts }                                                         from '../release-artifacts';
import type { NewUpdateCycle }                                                      from '../triggers/updater-trigger';
import { UiBucketUpdater }                                                          from '../ui-bucket-updater';
import { UpdateCycle }                                                              from '../update-cycle';
import { EDGE_REGION, type RegionClients, RootStackResources, type UpdaterClients } from '../updater-clients';
import type { HttpTriggerEvent }                                                    from '../updater-event';
import {
  toArtifactBucketName,
  toArtifactName,
  toArtifactPackageName,
  toArtifactVersion,
  toContentBucketName,
  toDistributionArn,
  toLambdaFunctionArn,
} from '../updater-identifiers';
import type { FailedUpdater, ReadyUpdater } from '../updater-runtime';

/** The functions of the faked release registry package, which a suite sets up per test. */
export interface RegistryMocks {
  readonly readReleasePointer: jest.Mock;
  readonly deriveTrack:        jest.Mock;
  readonly buildArtifactKey:   jest.Mock;
}

/** The part of the release a faked `buildArtifactKey` reads: the parsed version and the name of the object. */
export interface ReleaseKeyParts {
  readonly version:    { readonly version: string };
  readonly objectName: string;
}

/** What the faked registry's `buildArtifactKey` is called with: the kind of artifact, its package and the release. */
export type BuildArtifactKeyArguments = [kind: string, packageName: string, release: ReleaseKeyParts];

/** The values of a target in the plain strings tests write; the helpers brand them. */
export interface TargetValues {
  readonly arn?:             string;
  readonly packageName?:     string;
  readonly artifactName?:    string;
  readonly deployedVersion?: string;
  readonly bucketName?:      string;
}

export const LAMBDA_ARN                = 'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go';
export const DISTRIBUTION_ARN          = 'arn:aws:cloudfront::123456789012:distribution/ABCD1234';
export const EU_WEST_1                 = toRegion('eu-west-1');
export const US_WEST_2                 = toRegion('us-west-2');
export const ARTIFACT_BUCKET_US_EAST_1 = toArtifactBucketName('mailbox-artifacts-us-east-1');

/** The release a target deployed at 1.2.3 is behind on. */
export const NEWER_VERSION = toArtifactVersion('1.2.4');

export const testConfig: Config = {
  logLevel:           'error',
  serviceName:        'artifact-updater',
  region:             EDGE_REGION,
  functionName:       'artifact-updater-function',
  project:            'serverlessinbox',
  distTag:            'latest',
  granularity:        'major',
  artifactBucketBase: 'mailbox-artifacts',
  rootStackTagValue:  'my-stack',
  rootStackId:        'guid-1',
};

/** The environment the entry point reads, with every variable the updater configuration requires. */
export const GOOD_ENVIRONMENT: Record<string, string> = {
  SERVICE_NAME:             'artifact-updater',
  AWS_REGION:               'eu-west-1',
  AWS_LAMBDA_FUNCTION_NAME: 'artifact-updater-function',
  PROJECT:                  'serverlessinbox',
  DIST_TAG:                 'latest',
  GRANULARITY:              'major',
  ARTIFACT_BUCKET_BASE:     'mailbox-artifacts',
  ROOT_STACK_TAG_VALUE:     'my-stack',
  ROOT_STACK_ID:            'guid-1',
};

/** The resources of the root stack the updater tests run against. */
export function testRootStackResources(): RootStackResources {
  return new RootStackResources(testConfig.rootStackTagValue, testConfig.rootStackId);
}

/** Resolves at once, so a test does not wait out a poll interval or a retry delay. */
export const noSleep: Sleep = async () => undefined;

/**
 * The module a suite's `jest.mock('@serverlessinbox/artifact-registry', ...)` factory returns: the registry's three
 * functions as jest mocks, which the suite then reads back with registryMocks().
 */
export function artifactRegistryModuleMock(): RegistryMocks {
  return {
    deriveTrack:        jest.fn(),
    buildArtifactKey:   jest.fn(),
    readReleasePointer: jest.fn(),
  };
}

/** The registered registry mock of the suite, typed. Call it after the suite's `jest.mock` of the registry. */
export function registryMocks(): RegistryMocks {
  return jest.requireMock('@serverlessinbox/artifact-registry') as RegistryMocks;
}

function regionClients(region: Region): RegionClients {
  return { region, lambda: new LambdaClient({ region }), tagging: new ResourceGroupsTaggingAPIClient({ region }) };
}

/**
 * Stands in for the clients the entry point builds. The instances are real SDK clients so tests can stub them
 * with aws-sdk-client-mock; the edge set is shared with the deployment set when the deployment region is the
 * edge region, as in the entry point.
 */
export function fakeUpdaterClients(deploymentRegion: Region = EDGE_REGION): UpdaterClients {
  const deployment = regionClients(deploymentRegion);
  return {
    registryS3: new S3Client({ region: deploymentRegion }),
    deployment,
    edge:       deploymentRegion === EDGE_REGION ? deployment : regionClients(EDGE_REGION),
    cloudFront: new CloudFrontClient({ region: EDGE_REGION }),
  };
}

export function lambdaTarget(values: TargetValues = {}): LambdaTarget {
  return {
    arn:             toLambdaFunctionArn(values.arn ?? LAMBDA_ARN),
    packageName:     toArtifactPackageName(values.packageName ?? 'mailbox-go'),
    artifactName:    toArtifactName(values.artifactName ?? 'mailbox-go'),
    deployedVersion: toArtifactVersion(values.deployedVersion ?? '1.2.3'),
  };
}

export function uiTarget(values: TargetValues = {}): UiTarget {
  return {
    arn:             toDistributionArn(values.arn ?? DISTRIBUTION_ARN),
    bucketName:      toContentBucketName(values.bucketName ?? 'ui-content-bucket'),
    packageName:     toArtifactPackageName(values.packageName ?? 'ui-bundle'),
    artifactName:    toArtifactName(values.artifactName ?? 'ui-bundle.zip'),
    deployedVersion: toArtifactVersion(values.deployedVersion ?? '1.2.3'),
  };
}

/** What a test may replace when it builds the update cycle's graph. */
export interface UpdaterOverrides {
  readonly deploymentRegion?: Region;
  readonly sleep?:            Sleep;
}

/** The update cycle and the updaters it holds, so a suite can read back the one it exercises. */
export interface UpdaterParts {
  readonly cycle:       UpdateCycle;
  readonly clients:     UpdaterClients;
  readonly codeUpdater: LambdaCodeUpdater;
  readonly edgeUpdater: EdgeLambdaUpdater;
  readonly uiUpdater:   UiBucketUpdater;
}

/**
 * Wires the update cycle and its updaters from real parts over fake clients. A suite that fakes one of the updater
 * modules still gets the same graph; the overrides change only the deployment region and the sleep between polls.
 */
export function buildUpdaterParts(overrides: UpdaterOverrides = {}): UpdaterParts {
  const clients            = fakeUpdaterClients(overrides.deploymentRegion);
  const logger             = new LoggerBuffer(undefined, 'debug');
  const releases           = new ReleaseArtifacts(clients.registryS3, testConfig, logger);
  const functionCode       = new LambdaFunctionCode(noSleep);
  const smokeTester        = new FunctionSmokeTester(logger);
  const rollback           = new LambdaCodeRollback(functionCode, logger);
  const rootStackResources = testRootStackResources();
  const codeUpdater        = new LambdaCodeUpdater(releases, functionCode, smokeTester, rollback, logger);
  const edgeUpdater        = new EdgeLambdaUpdater(
    clients.edge,
    clients.cloudFront,
    rootStackResources,
    releases,
    functionCode,
    smokeTester,
    rollback,
    logger,
    overrides.sleep ?? noSleep,
  );
  const uiUpdater          = new UiBucketUpdater(clients.registryS3, clients.deployment, clients.cloudFront, releases, logger);
  const cycle              = new UpdateCycle(testConfig, clients, rootStackResources, logger, codeUpdater, edgeUpdater, uiUpdater);
  return { cycle, clients, codeUpdater, edgeUpdater, uiUpdater };
}

/** An update cycle built by buildUpdaterParts, for the triggers that take a factory for one. */
export function newUpdateCycle(): UpdateCycle {
  return buildUpdaterParts().cycle;
}

export const BAD_CONFIG_ERROR = 'LOG_LEVEL: invalid log level "verbose"';

/** What the composition hands a trigger as its update-cycle factory when the configuration failed to load. */
export const badConfigCycle: NewUpdateCycle = () => {
  throw new Error(BAD_CONFIG_ERROR);
};

/** What the entry point hands to the composition when the configuration loaded, with fake clients. */
export function readyRuntime(): ReadyUpdater {
  return { config: testConfig, cloudFormation: fakeCloudFormationClient(), clients: fakeUpdaterClients(), error: undefined };
}

/** What the entry point hands to the composition when the configuration failed to load: no clients but CloudFormation's. */
export function failedRuntime(): FailedUpdater {
  return { config: testConfig, cloudFormation: fakeCloudFormationClient(), clients: undefined, error: BAD_CONFIG_ERROR };
}

/** A real SDK client, so a test can stub it with aws-sdk-client-mock. */
export function fakeCloudFormationClient(): CloudFormationClient {
  return new CloudFormationClient({ region: EDGE_REGION });
}

/**
 * A CloudFormation request to the deploy-end trigger, with the fields CloudFormation sends and the properties
 * the template gives the resource: the service token and timeout every custom resource carries, and the nonce.
 * The properties are strings, as they arrive.
 */
export function deployEndTriggerEvent(requestType: 'Create' | 'Update' | 'Delete'): CloudFormationCustomResourceEvent {
  const base       = {
    ServiceToken:      'arn:aws:lambda:us-east-1:123456789012:function:artifact-updater',
    ResponseURL:       'https://cloudformation-custom-resource-response-url.example.com/',
    StackId:           'arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/guid',
    RequestId:         'request-id-1',
    LogicalResourceId: 'autoupdatertrackedupdatetriggersdeployendcr3655FAB6',
    ResourceType:      'Custom::DeployEndTrigger',
  };
  const properties = { ServiceToken: base.ServiceToken, ServiceTimeout: '600', Nonce: '1700000000000' };

  if (requestType === 'Create') {
    return { ...base, RequestType: 'Create', ResourceProperties: properties };
  }
  if (requestType === 'Delete') {
    return { ...base, RequestType: 'Delete', PhysicalResourceId: 'deploy-end-physical-id', ResourceProperties: properties };
  }
  return {
    ...base,
    RequestType:           'Update',
    PhysicalResourceId:    'deploy-end-physical-id',
    ResourceProperties:    properties,
    OldResourceProperties: { ...properties, Nonce: '1600000000000' },
  };
}

/** An API Gateway v2 request with every field the gateway sends, for the given method and path. */
export function httpApiEvent(method: string, path: string): HttpTriggerEvent {
  const event: APIGatewayProxyEventV2 = {
    version:         '2.0',
    routeKey:        `${method} ${path}`,
    rawPath:         path,
    rawQueryString:  '',
    headers:         { 'content-type': 'application/json' },
    isBase64Encoded: false,
    requestContext:  {
      accountId:    '123456789012',
      apiId:        'api-id',
      domainName:   'example.com',
      domainPrefix: 'example',
      http:         { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId:    'request-id',
      routeKey:     `${method} ${path}`,
      stage:        '$default',
      time:         '26/Jul/2026:14:30:45 +0000',
      timeEpoch:    1753616445000,
    },
  };
  return { ...event, requestContext: { ...event.requestContext, http: { ...event.requestContext.http } } };
}

/** A Lambda context that carries only the fields the handler passes on. */
export function fakeLambdaContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName:                   'artifact-updater',
    functionVersion:                '$LATEST',
    invokedFunctionArn:             'arn:aws:lambda:us-east-1:123456789012:function:artifact-updater',
    memoryLimitInMB:                '256',
    awsRequestId:                   'test-request-id',
    logGroupName:                   '/aws/lambda/artifact-updater',
    logStreamName:                  'test-log-stream',
    getRemainingTimeInMillis:       () => 300000,
    done:                           () => undefined,
    fail:                           () => undefined,
    succeed:                        () => undefined,
  };
}

/**
 * Routes the mocked `https.request` (the suite must `jest.mock('https', ...)`) into memory, answering the PUT
 * with status 200, and returns a function yielding the body that was sent to CloudFormation's response URL.
 */
export function captureCloudFormationResponse(): () => string {
  let body = '';
  jest.mocked(https.request).mockImplementation(((...args: [unknown, (res: object) => void]) => {
    args[1]({ statusCode: 200 });
    return new Writable({
      write(chunk: Buffer, ...rest: [BufferEncoding, (error?: Error | null) => void]) {
        body += chunk.toString();
        rest[1]();
      },
    });
  }) as typeof https.request);
  return () => body;
}

/** A successful Lambda invoke response whose payload is the given text, as bytes like the real SDK returns it. */
export function invokeResponse(payload: string): InvokeCommandOutput {
  const encoder = new TextEncoder();
  return {
    StatusCode: 200,
    Payload:    encoder.encode(payload) as InvokeCommandOutput['Payload'],
    $metadata:  {},
  };
}
