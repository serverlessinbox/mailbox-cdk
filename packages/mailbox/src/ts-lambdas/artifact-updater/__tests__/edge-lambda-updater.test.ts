/// <reference types="jest" />

/**
 * Pins the edge update path: new code is published as a version, that version is probed with the smoke test,
 * and only when it passes is every association of the function in its distribution pointed at it, with the ETag
 * of the configuration that was read, not the one of the list. A version that fails the probe or cannot be
 * probed never reaches the distribution, which would otherwise serve it to every viewer. A function that fails
 * midway must not be tagged with a version it does not run, and a code update that Lambda rejects because
 * another update is in progress is retried a limited number of times.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  GetDistributionConfigCommand,
  ListDistributionsCommand,
  UpdateDistributionCommand,
  CloudFrontClient,
  type DefaultCacheBehavior,
  type DistributionConfig,
  type DistributionSummary,
  type LambdaFunctionAssociation,
} from '@aws-sdk/client-cloudfront';
import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  PublishVersionCommand,
  ResourceConflictException,
  TagResourceCommand,
  UpdateFunctionCodeCommand,
} from '@aws-sdk/client-lambda';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { EdgeLambdaUpdater } from '../edge-lambda-updater';
import { FunctionSmokeTester } from '../function-smoke-tester';
import { LambdaCodeRollback } from '../lambda-code-rollback';
import { LambdaFunctionCode } from '../lambda-function-code';
import { ReleaseArtifacts } from '../release-artifacts';
import {
  fakeUpdaterClients,
  invokeResponse,
  lambdaTarget,
  noSleep,
  testConfig,
  type RegistryMocks,
} from './updater-helpers';

jest.mock('@serverlessinbox/artifact-registry', () => ({
  deriveTrack: jest.fn(),
  buildArtifactKey: jest.fn(),
  readReleasePointer: jest.fn(),
}));

const { readReleasePointer, deriveTrack, buildArtifactKey } = jest.requireMock(
  '@serverlessinbox/artifact-registry',
) as RegistryMocks;

const EDGE_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda';
const OTHER_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:other-lambda';
const NEW_VERSION_ARN = `${EDGE_ARN}:5`;

function association(arn: string, eventType: 'origin-request' | 'viewer-request'): LambdaFunctionAssociation {
  return { EventType: eventType, LambdaFunctionARN: arn };
}

function cacheBehavior(associations: LambdaFunctionAssociation[]): DefaultCacheBehavior {
  return {
    TargetOriginId: 'origin',
    ViewerProtocolPolicy: 'allow-all',
    LambdaFunctionAssociations: { Quantity: associations.length, Items: associations },
  } as DefaultCacheBehavior;
}

function behaviorsOf(defaults: LambdaFunctionAssociation[], additional: LambdaFunctionAssociation[]) {
  return {
    DefaultCacheBehavior: cacheBehavior(defaults),
    CacheBehaviors: {
      Quantity: additional.length,
      Items: additional.length > 0 ? [{ ...cacheBehavior(additional), PathPattern: '/api/*' }] : [],
    },
  };
}

function distributionSummary(
  id: string,
  defaults: LambdaFunctionAssociation[],
  additional: LambdaFunctionAssociation[] = [],
  hasDomainName = true,
): DistributionSummary {
  return {
    Id: id,
    DomainName: hasDomainName ? `${id}.cloudfront.net` : undefined,
    ...behaviorsOf(defaults, additional),
  } as DistributionSummary;
}

function distributionConfig(defaults: LambdaFunctionAssociation[], additional: LambdaFunctionAssociation[] = []): DistributionConfig {
  return { CallerReference: 'ref', Comment: 'test', Enabled: true, ...behaviorsOf(defaults, additional) } as DistributionConfig;
}

describe('EdgeLambdaUpdater', () => {
  const lambdaMock = mockClient(LambdaClient);
  const cloudFrontMock = mockClient(CloudFrontClient);
  const clients = fakeUpdaterClients();
  const sleep = jest.fn(async () => undefined);
  const target = lambdaTarget({ arn: EDGE_ARN, packageName: 'edge-pkg', artifactName: 'edge-lambda' });

  function newUpdater(): EdgeLambdaUpdater {
    const logger = new LoggerBuffer();
    const functionCode = new LambdaFunctionCode(noSleep);
    return new EdgeLambdaUpdater(
      clients.edge,
      clients.cloudFront,
      new ReleaseArtifacts(clients.registryS3, testConfig, logger),
      functionCode,
      new FunctionSmokeTester(logger),
      new LambdaCodeRollback(functionCode, logger),
      logger,
      sleep,
    );
  }

  function distributionsListing(...summaries: DistributionSummary[]): void {
    cloudFrontMock.on(ListDistributionsCommand).resolves({
      DistributionList: { IsTruncated: false, Items: summaries, Marker: '', MaxItems: 100, Quantity: summaries.length },
    });
  }

  function conflict(): ResourceConflictException {
    return new ResourceConflictException({ message: 'update in progress', $metadata: {} });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    lambdaMock.reset();
    cloudFrontMock.reset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    deriveTrack.mockReturnValue('v1');
    readReleasePointer.mockResolvedValue({ version: '1.2.4' });
    buildArtifactKey.mockImplementation(
      (_kind: string, _package: string, release: { version: { version: string }; objectName: string }) =>
        `edge-pkg/release/${release.version.version}/${release.objectName}`,
    );
    lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
    lambdaMock.on(GetFunctionConfigurationCommand).resolves({ LastUpdateStatus: 'Successful' });
    lambdaMock.on(PublishVersionCommand).resolves({ FunctionArn: NEW_VERSION_ARN });
    lambdaMock.on(InvokeCommand).resolves(invokeResponse('{"serverlessInboxSmokeTestOk":true}'));
    lambdaMock.on(TagResourceCommand).resolves({});
    cloudFrontMock.on(UpdateDistributionCommand).resolves({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing and reports false when the function is not behind', async () => {
    readReleasePointer.mockResolvedValue(null);

    const updated = await newUpdater().advanceIfStale(target);

    expect(updated).toBe(false);
    expect(lambdaMock.calls()).toHaveLength(0);
    expect(cloudFrontMock.calls()).toHaveLength(0);
  });

  it('replaces the code, publishes a version, repoints the distribution with the ETag it read, and tags', async () => {
    distributionsListing(distributionSummary('DIST123', [association(`${EDGE_ARN}:3`, 'origin-request')]));
    cloudFrontMock.on(GetDistributionConfigCommand).resolves({
      DistributionConfig: distributionConfig([association(`${EDGE_ARN}:3`, 'origin-request')]),
      ETag: 'config-etag',
    });

    const updated = await newUpdater().advanceIfStale(target);

    expect(updated).toBe(true);
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)[0].args[0].input).toEqual({
      FunctionName: EDGE_ARN,
      S3Bucket: 'mailbox-artifacts-us-east-1',
      S3Key: 'edge-pkg/release/1.2.4/lambdas/edge-lambda.zip',
    });
    expect(lambdaMock.commandCalls(PublishVersionCommand)[0].args[0].input).toEqual({ FunctionName: EDGE_ARN });
    expect(lambdaMock.commandCalls(InvokeCommand)[0].args[0].input.FunctionName).toBe(NEW_VERSION_ARN);
    expect(cloudFrontMock.commandCalls(GetDistributionConfigCommand)[0].args[0].input).toEqual({ Id: 'DIST123' });
    const update = cloudFrontMock.commandCalls(UpdateDistributionCommand)[0].args[0].input;
    expect(update.Id).toBe('DIST123');
    expect(update.IfMatch).toBe('config-etag');
    expect(update.DistributionConfig?.DefaultCacheBehavior?.LambdaFunctionAssociations?.Items?.[0].LambdaFunctionARN).toBe(
      NEW_VERSION_ARN,
    );
    expect(lambdaMock.commandCalls(TagResourceCommand)[0].args[0].input.Tags).toEqual({
      'serverless-inbox:artifact-version': '1.2.4',
    });
  });

  describe.each([
    ['fails', () => lambdaMock.on(InvokeCommand).resolves(invokeResponse('{"serverlessInboxSmokeTestOk":false}')), 'fail'],
    ['cannot be run', () => lambdaMock.on(InvokeCommand).rejects(new Error('AccessDenied')), 'unprobeable'],
  ])('when the smoke test of the published version %s', (_description, arrangeProbe, expectedVerdict) => {
    it('leaves the distribution on its version, puts the code back on the deployed release and writes no tag', async () => {
      distributionsListing(distributionSummary('DIST123', [association(`${EDGE_ARN}:3`, 'origin-request')]));
      arrangeProbe();

      const updated = await newUpdater().advanceIfStale(target);

      expect(updated).toBe(false);
      expect(cloudFrontMock.calls()).toHaveLength(0);
      expect(lambdaMock.commandCalls(TagResourceCommand)).toHaveLength(0);
      expect(lambdaMock.commandCalls(PublishVersionCommand)).toHaveLength(1);
      expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand).map((call) => call.args[0].input.S3Key)).toEqual([
        'edge-pkg/release/1.2.4/lambdas/edge-lambda.zip',
        'edge-pkg/release/1.2.3/lambdas/edge-lambda.zip',
      ]);
      expect(console.error).toHaveBeenCalledWith('smoke test did not pass, rolling back', {
        lambdaArn: EDGE_ARN,
        verdict: expectedVerdict,
        failedVersion: '1.2.4',
        deployedVersion: '1.2.3',
      });
    });
  });

  it('finds the distribution through a non-default cache behavior and repoints every association of the function', async () => {
    distributionsListing(distributionSummary('DIST456', [], [association(`${EDGE_ARN}:3`, 'viewer-request')]));
    cloudFrontMock.on(GetDistributionConfigCommand).resolves({
      DistributionConfig: distributionConfig(
        [association(`${EDGE_ARN}:3`, 'origin-request'), association(`${OTHER_ARN}:7`, 'origin-request')],
        [association(`${EDGE_ARN}:3`, 'viewer-request')],
      ),
      ETag: 'config-etag',
    });

    await newUpdater().advanceIfStale(target);

    const updated = cloudFrontMock.commandCalls(UpdateDistributionCommand)[0].args[0].input.DistributionConfig;
    expect(updated?.DefaultCacheBehavior?.LambdaFunctionAssociations?.Items?.map((a) => a.LambdaFunctionARN)).toEqual([
      NEW_VERSION_ARN,
      `${OTHER_ARN}:7`,
    ]);
    expect(updated?.CacheBehaviors?.Items?.[0].LambdaFunctionAssociations?.Items?.[0].LambdaFunctionARN).toBe(
      NEW_VERSION_ARN,
    );
  });

  describe('when no distribution can be repointed', () => {
    it.each([
      ['no distribution uses the function', [distributionSummary('DIST_OTHER', [association(`${OTHER_ARN}:1`, 'origin-request')])]],
      [
        'the only distribution that uses it has no domain name',
        [distributionSummary('DIST_NODOMAIN', [association(`${EDGE_ARN}:3`, 'origin-request')], [], false)],
      ],
    ])('rejects, logs and does not tag when %s', async (_description, summaries) => {
      distributionsListing(...summaries);

      await expect(newUpdater().advanceIfStale(target)).rejects.toThrow(
        `No CloudFront distribution found for edge lambda ${EDGE_ARN}`,
      );

      expect(cloudFrontMock.commandCalls(UpdateDistributionCommand)).toHaveLength(0);
      expect(lambdaMock.commandCalls(TagResourceCommand)).toHaveLength(0);
      expect(console.error).toHaveBeenCalledWith('failed to update edge lambda', {
        edgeLambdaArn: EDGE_ARN,
        error: `No CloudFront distribution found for edge lambda ${EDGE_ARN}`,
      });
    });

    it('rejects when the distribution configuration comes back without an ETag', async () => {
      distributionsListing(distributionSummary('DIST123', [association(`${EDGE_ARN}:3`, 'origin-request')]));
      cloudFrontMock.on(GetDistributionConfigCommand).resolves({
        DistributionConfig: distributionConfig([association(`${EDGE_ARN}:3`, 'origin-request')]),
      });

      await expect(newUpdater().advanceIfStale(target)).rejects.toThrow(
        `No CloudFront distribution found for edge lambda ${EDGE_ARN}`,
      );
      expect(cloudFrontMock.commandCalls(UpdateDistributionCommand)).toHaveLength(0);
    });
  });

  it('rejects before touching CloudFront when the published version has no ARN', async () => {
    lambdaMock.on(PublishVersionCommand).resolves({});

    await expect(newUpdater().advanceIfStale(target)).rejects.toThrow('PublishVersion returned no FunctionArn');

    expect(cloudFrontMock.calls()).toHaveLength(0);
    expect(lambdaMock.commandCalls(TagResourceCommand)).toHaveLength(0);
  });

  describe('when Lambda rejects the code update because another update is in progress', () => {
    beforeEach(() => {
      distributionsListing(distributionSummary('DIST123', [association(`${EDGE_ARN}:3`, 'origin-request')]));
      cloudFrontMock.on(GetDistributionConfigCommand).resolves({
        DistributionConfig: distributionConfig([association(`${EDGE_ARN}:3`, 'origin-request')]),
        ETag: 'config-etag',
      });
    });

    it('retries after 3 and then 6 seconds and goes on when the third attempt succeeds', async () => {
      lambdaMock.on(UpdateFunctionCodeCommand).rejectsOnce(conflict()).rejectsOnce(conflict()).resolves({});

      const updated = await newUpdater().advanceIfStale(target);

      expect(updated).toBe(true);
      expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(3);
      expect(sleep.mock.calls).toEqual([[3000], [6000]]);
    });

    it('gives up with the conflict after the third attempt, without publishing', async () => {
      lambdaMock.on(UpdateFunctionCodeCommand).rejects(conflict());

      await expect(newUpdater().advanceIfStale(target)).rejects.toThrow('update in progress');

      expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(3);
      expect(lambdaMock.commandCalls(PublishVersionCommand)).toHaveLength(0);
    });

    it('does not retry any other failure', async () => {
      lambdaMock.on(UpdateFunctionCodeCommand).rejects(new Error('AccessDenied'));

      await expect(newUpdater().advanceIfStale(target)).rejects.toThrow('AccessDenied');

      expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
    });
  });
});
