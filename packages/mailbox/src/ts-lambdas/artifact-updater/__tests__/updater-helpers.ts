/// <reference types="jest" />

import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { LambdaClient, type InvokeCommandOutput } from '@aws-sdk/client-lambda';
import { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { S3Client } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2, CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import type { LambdaTarget, UiTarget } from '../artifact-target';
import type { Config } from '../config';
import { EdgeLambdaUpdater } from '../edge-lambda-updater';
import { FunctionSmokeTester } from '../function-smoke-tester';
import { LambdaCodeRollback } from '../lambda-code-rollback';
import { LambdaCodeUpdater } from '../lambda-code-updater';
import { LambdaFunctionCode, type Sleep } from '../lambda-function-code';
import { ReleaseArtifacts } from '../release-artifacts';
import type { HttpTriggerEvent } from '../updater-event';
import { UiBucketUpdater } from '../ui-bucket-updater';
import { UpdateCycle } from '../update-cycle';
import { EDGE_REGION, type RegionClients, type UpdaterClients } from '../updater-clients';
import type { FailedUpdater, ReadyUpdater } from '../updater-runtime';
import type { NewUpdateCycle } from '../updater-trigger';
import {
  toArtifactName,
  toArtifactPackageName,
  toArtifactVersion,
  toContentBucketName,
  toDistributionArn,
  toLambdaFunctionArn,
} from '../updater-identifiers';

/** The functions of the faked release registry package, which a suite sets up per test. */
export interface RegistryMocks {
  readonly readReleasePointer: jest.Mock;
  readonly deriveTrack: jest.Mock;
  readonly buildArtifactKey: jest.Mock;
}

/** The values of a target in the plain strings tests write; the helpers brand them. */
export interface TargetValues {
  readonly arn?: string;
  readonly packageName?: string;
  readonly artifactName?: string;
  readonly deployedVersion?: string;
  readonly bucketName?: string;
}

export const LAMBDA_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:mailbox-go';
export const DISTRIBUTION_ARN = 'arn:aws:cloudfront::123456789012:distribution/ABCD1234';

export const testConfig: Config = {
  logLevel: 'error',
  serviceName: 'artifact-updater',
  region: 'us-east-1',
  functionName: 'artifact-updater-function',
  project: 'serverlessinbox',
  distTag: 'latest',
  granularity: 'major',
  artifactBucketBase: 'mailbox-artifacts',
  rootStackTagValue: 'my-stack',
};

/** Resolves at once, so a test does not wait out a poll interval or a retry delay. */
export const noSleep: Sleep = async () => undefined;

function regionClients(region: string): RegionClients {
  return { region, lambda: new LambdaClient({ region }), tagging: new ResourceGroupsTaggingAPIClient({ region }) };
}

/**
 * Stands in for the clients the entry point builds. The instances are real SDK clients so tests can stub them
 * with aws-sdk-client-mock; the edge set is shared with the deployment set when the deployment region is the
 * edge region, as in the entry point.
 */
export function fakeUpdaterClients(deploymentRegion: string = EDGE_REGION): UpdaterClients {
  const deployment = regionClients(deploymentRegion);
  return {
    registryS3: new S3Client({ region: deploymentRegion }),
    deployment,
    edge: deploymentRegion === EDGE_REGION ? deployment : regionClients(EDGE_REGION),
    cloudFront: new CloudFrontClient({ region: EDGE_REGION }),
  };
}

export function lambdaTarget(values: TargetValues = {}): LambdaTarget {
  return {
    arn: toLambdaFunctionArn(values.arn ?? LAMBDA_ARN),
    packageName: toArtifactPackageName(values.packageName ?? 'mailbox-go'),
    artifactName: toArtifactName(values.artifactName ?? 'mailbox-go'),
    deployedVersion: toArtifactVersion(values.deployedVersion ?? '1.2.3'),
  };
}

export function uiTarget(values: TargetValues = {}): UiTarget {
  return {
    arn: toDistributionArn(values.arn ?? DISTRIBUTION_ARN),
    bucketName: toContentBucketName(values.bucketName ?? 'ui-content-bucket'),
    packageName: toArtifactPackageName(values.packageName ?? 'ui-bundle'),
    artifactName: toArtifactName(values.artifactName ?? 'ui-bundle.zip'),
    deployedVersion: toArtifactVersion(values.deployedVersion ?? '1.2.3'),
  };
}

/** An update cycle wired from real parts over fake clients; a suite that fakes the cycle's module gets a fake instead. */
export function newUpdateCycle(): UpdateCycle {
  const clients = fakeUpdaterClients();
  const logger = new LoggerBuffer();
  const releases = new ReleaseArtifacts(clients.registryS3, testConfig, logger);
  const functionCode = new LambdaFunctionCode(noSleep);
  const smokeTester = new FunctionSmokeTester(logger);
  const rollback = new LambdaCodeRollback(functionCode, logger);
  return new UpdateCycle(
    testConfig,
    clients,
    logger,
    new LambdaCodeUpdater(releases, functionCode, smokeTester, rollback, logger),
    new EdgeLambdaUpdater(
      clients.edge,
      clients.cloudFront,
      releases,
      functionCode,
      smokeTester,
      rollback,
      logger,
      noSleep,
    ),
    new UiBucketUpdater(clients.registryS3, clients.deployment, clients.cloudFront, releases, logger),
  );
}

export const BAD_CONFIG_ERROR = 'LOG_LEVEL: invalid log level "verbose"';

/** What the composition hands a trigger as its update-cycle factory when the configuration failed to load. */
export const badConfigCycle: NewUpdateCycle = () => {
  throw new Error(BAD_CONFIG_ERROR);
};

/** What the entry point hands to the composition when the configuration loaded, with fake clients. */
export function readyRuntime(): ReadyUpdater {
  return { config: testConfig, clients: fakeUpdaterClients(), error: undefined };
}

/** What the entry point hands to the composition when the configuration failed to load: no clients. */
export function failedRuntime(): FailedUpdater {
  return { config: testConfig, clients: undefined, error: BAD_CONFIG_ERROR };
}

/**
 * A CloudFormation request to the deploy-end trigger, with the fields CloudFormation sends and the properties
 * the template gives the resource: the service token and timeout every custom resource carries, and the nonce.
 * The properties are strings, as they arrive.
 */
export function deployEndTriggerEvent(requestType: 'Create' | 'Update' | 'Delete'): CloudFormationCustomResourceEvent {
  const base = {
    ServiceToken: 'arn:aws:lambda:us-east-1:123456789012:function:artifact-updater',
    ResponseURL: 'https://cloudformation-custom-resource-response-url.example.com/',
    StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/guid',
    RequestId: 'request-id-1',
    LogicalResourceId: 'autoupdatertrackedupdatetriggersdeployendcr3655FAB6',
    ResourceType: 'Custom::DeployEndTrigger',
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
    RequestType: 'Update',
    PhysicalResourceId: 'deploy-end-physical-id',
    ResourceProperties: properties,
    OldResourceProperties: { ...properties, Nonce: '1600000000000' },
  };
}

/** An API Gateway v2 request with every field the gateway sends, for the given method and path. */
export function httpApiEvent(method: string, path: string): HttpTriggerEvent {
  const event: APIGatewayProxyEventV2 = {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      domainName: 'example.com',
      domainPrefix: 'example',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'request-id',
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: '26/Jul/2026:14:30:45 +0000',
      timeEpoch: 1753616445000,
    },
  };
  return { ...event, requestContext: { ...event.requestContext, http: { ...event.requestContext.http } } };
}

/** A Lambda context that carries only the fields the handler passes on. */
export function fakeLambdaContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'artifact-updater',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:artifact-updater',
    memoryLimitInMB: '256',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/artifact-updater',
    logStreamName: 'test-log-stream',
    getRemainingTimeInMillis: () => 300000,
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
  };
}

/** A successful Lambda invoke response whose payload is the given text, as bytes like the real SDK returns it. */
export function invokeResponse(payload: string): InvokeCommandOutput {
  return {
    StatusCode: 200,
    Payload: new TextEncoder().encode(payload) as InvokeCommandOutput['Payload'],
    $metadata: {},
  };
}
