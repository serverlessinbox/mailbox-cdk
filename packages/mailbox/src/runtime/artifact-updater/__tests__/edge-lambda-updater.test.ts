/// <reference types="jest" />

/**
 * Pins the edge update path: new code is published as a version, that version is probed with the smoke test,
 * and only when it passes is every association of the function in its distribution pointed at it, with the ETag
 * of the configuration that was read. The distribution is found among those carrying the root stack tag of this
 * install, never by listing the account, so a distribution of another install that associates the same function
 * name is never repointed. A version that fails the probe or cannot be probed never reaches the distribution,
 * which would otherwise serve it to every viewer. A function that fails midway must not be tagged with a version
 * it does not run, and a code update that Lambda rejects because another update is in progress is retried a
 * limited number of times.
 */

import {
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  CloudFrontClient,
  type DefaultCacheBehavior,
  type DistributionConfig,
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
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { ServerlessInboxTagKeys }                              from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                          from 'aws-sdk-client-mock';

import {
  buildUpdaterParts,
  invokeResponse,
  lambdaTarget,
  registryMocks,
} from './updater-helpers';

jest.mock('@serverlessinbox/artifact-registry', () =>
  (jest.requireActual('./updater-helpers') as typeof import('./updater-helpers')).artifactRegistryModuleMock(),
);

const { readReleasePointer } = registryMocks();

const EDGE_ARN        = 'arn:aws:lambda:us-east-1:123456789012:function:edge-lambda';
const OTHER_ARN       = 'arn:aws:lambda:us-east-1:123456789012:function:other-lambda';
const NEW_VERSION_ARN = `${EDGE_ARN}:5`;

function association(arn: string, eventType: 'origin-request' | 'viewer-request'): LambdaFunctionAssociation {
  return { EventType: eventType, LambdaFunctionARN: arn };
}

function cacheBehavior(associations: LambdaFunctionAssociation[]): DefaultCacheBehavior {
  return {
    TargetOriginId:             'origin',
    ViewerProtocolPolicy:       'allow-all',
    LambdaFunctionAssociations: { Quantity: associations.length, Items: associations },
  };
}

function behaviorsOf(
  defaults: LambdaFunctionAssociation[],
  additional: LambdaFunctionAssociation[],
): Pick<DistributionConfig, 'DefaultCacheBehavior' | 'CacheBehaviors'> {
  return {
    DefaultCacheBehavior: cacheBehavior(defaults),
    CacheBehaviors:       {
      Quantity: additional.length,
      Items:    additional.length > 0 ? [{ ...cacheBehavior(additional), PathPattern: '/api/*' }] : [],
    },
  };
}

function distributionArn(id: string): string {
  return `arn:aws:cloudfront::123456789012:distribution/${id}`;
}

function distributionConfig(defaults: LambdaFunctionAssociation[], additional: LambdaFunctionAssociation[] = []): DistributionConfig {
  return {
    CallerReference: 'ref',
    Comment:         'test',
    Enabled:         true,
    Origins:         { Quantity: 0, Items: [] },
    ...behaviorsOf(defaults, additional),
  };
}

describe('EdgeLambdaUpdater', () => {
  const lambdaMock     = mockClient(LambdaClient);
  const cloudFrontMock = mockClient(CloudFrontClient);
  const taggingMock    = mockClient(ResourceGroupsTaggingAPIClient);
  const sleep          = jest.fn(async () => undefined);
  const target         = lambdaTarget({ arn: EDGE_ARN, packageName: 'edge-pkg', artifactName: 'edge-lambda' });

  function newUpdater() {
    return buildUpdaterParts({ sleep }).edgeUpdater;
  }

  function taggedDistributions(...ids: string[]): void {
    taggingMock.on(GetResourcesCommand).resolves({
      ResourceTagMappingList: ids.map((id) => ({
        ResourceARN: distributionArn(id),
        Tags:        [{ Key: ServerlessInboxTagKeys.rootStackId, Value: 'guid-1' }],
      })),
    });
  }

  function distributionConfigOf(id: string, config: DistributionConfig, etag = 'config-etag'): void {
    cloudFrontMock.on(GetDistributionConfigCommand, { Id: id }).resolves({ DistributionConfig: config, ETag: etag });
  }

  function conflict(): ResourceConflictException {
    return new ResourceConflictException({ message: 'update in progress', $metadata: {} });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    lambdaMock.reset();
    cloudFrontMock.reset();
    taggingMock.reset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    readReleasePointer.mockResolvedValue({ version: '1.2.4' });
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
    taggedDistributions('DIST123');
    distributionConfigOf('DIST123', distributionConfig([association(`${EDGE_ARN}:3`, 'origin-request')]));

    const updated = await newUpdater().advanceIfStale(target);

    expect(updated).toBe(true);
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)[0].args[0].input).toMatchObject({
      S3Bucket: 'mailbox-artifacts-us-east-1',
      S3Key:    'serverlessinbox/packages/edge-pkg/releases/v1.2.4/lambdas/edge-lambda.zip',
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
    expect(Object.values(lambdaMock.commandCalls(TagResourceCommand)[0].args[0].input.Tags ?? {})).toEqual(['1.2.4']);
  });

  it('repoints the root stack distribution that associates the function, not another root stack one', async () => {
    taggedDistributions('DIST_UI', 'DIST_BLOB');
    distributionConfigOf('DIST_UI', distributionConfig([association(`${OTHER_ARN}:1`, 'origin-request')]));
    distributionConfigOf('DIST_BLOB', distributionConfig([association(`${EDGE_ARN}:3`, 'origin-request')]));

    await newUpdater().advanceIfStale(target);

    expect(cloudFrontMock.commandCalls(UpdateDistributionCommand).map((call) => call.args[0].input.Id)).toEqual(['DIST_BLOB']);
  });

  describe.each([
    {
      outcome:      'fails',
      arrangeProbe: () => lambdaMock.on(InvokeCommand).resolves(invokeResponse('{"serverlessInboxSmokeTestOk":false}')),
    },
    {
      outcome:      'cannot be run',
      arrangeProbe: () => lambdaMock.on(InvokeCommand).rejects(new Error('AccessDenied')),
    },
  ])('when the smoke test of the published version $outcome', ({ arrangeProbe }) => {
    it('leaves the distribution on its version, puts the code back on the deployed release and writes no tag', async () => {
      arrangeProbe();

      const updated = await newUpdater().advanceIfStale(target);

      expect(updated).toBe(false);
      expect(cloudFrontMock.calls()).toHaveLength(0);
      expect(lambdaMock.commandCalls(TagResourceCommand)).toHaveLength(0);
      expect(lambdaMock.commandCalls(PublishVersionCommand)).toHaveLength(1);
      expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand).map((call) => call.args[0].input.S3Key)).toEqual([
        'serverlessinbox/packages/edge-pkg/releases/v1.2.4/lambdas/edge-lambda.zip',
        'serverlessinbox/packages/edge-pkg/releases/v1.2.3/lambdas/edge-lambda.zip',
      ]);
    });
  });

  it('repoints an association written without a version suffix, and leaves another function without one alone', async () => {
    taggedDistributions('DIST123');
    distributionConfigOf(
      'DIST123',
      distributionConfig([association(OTHER_ARN, 'viewer-request'), association(EDGE_ARN, 'origin-request')]),
    );

    await newUpdater().advanceIfStale(target);

    const updated = cloudFrontMock.commandCalls(UpdateDistributionCommand)[0].args[0].input.DistributionConfig;
    expect(updated?.DefaultCacheBehavior?.LambdaFunctionAssociations?.Items?.map((item) => item.LambdaFunctionARN)).toEqual([
      OTHER_ARN,
      NEW_VERSION_ARN,
    ]);
  });

  it('rejects and logs, without rolling the code back, when tagging fails after the distribution was repointed', async () => {
    taggedDistributions('DIST123');
    distributionConfigOf('DIST123', distributionConfig([association(`${EDGE_ARN}:3`, 'origin-request')]));
    lambdaMock.on(TagResourceCommand).rejects(new Error('TagResource throttled'));

    await expect(newUpdater().advanceIfStale(target)).rejects.toThrow('TagResource throttled');

    expect(cloudFrontMock.commandCalls(UpdateDistributionCommand)).toHaveLength(1);
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith('failed to update edge lambda', {
      edgeLambdaArn: EDGE_ARN,
      error:         'TagResource throttled',
    });
  });

  it('finds the distribution through a non-default cache behavior and repoints every association of the function', async () => {
    taggedDistributions('DIST456');
    distributionConfigOf(
      'DIST456',
      distributionConfig(
        [association(`${EDGE_ARN}:3`, 'origin-request'), association(`${OTHER_ARN}:7`, 'origin-request')],
        [association(`${EDGE_ARN}:3`, 'viewer-request')],
      ),
    );

    await newUpdater().advanceIfStale(target);

    const updated = cloudFrontMock.commandCalls(UpdateDistributionCommand)[0].args[0].input.DistributionConfig;
    expect(updated?.DefaultCacheBehavior?.LambdaFunctionAssociations?.Items?.map((association) => association.LambdaFunctionARN)).toEqual([
      NEW_VERSION_ARN,
      `${OTHER_ARN}:7`,
    ]);
    expect(updated?.CacheBehaviors?.Items?.[0].LambdaFunctionAssociations?.Items?.[0].LambdaFunctionARN).toBe(
      NEW_VERSION_ARN,
    );
  });

  describe('when no distribution can be repointed', () => {
    it.each([
      { situation: 'no distribution carries the tag', taggedIds: [] as string[] },
      { situation: 'no tagged distribution uses the function', taggedIds: ['DIST_OTHER'] },
    ])('rejects, logs and does not tag when $situation', async ({ taggedIds }) => {
      taggedDistributions(...taggedIds);
      distributionConfigOf('DIST_OTHER', distributionConfig([association(`${OTHER_ARN}:1`, 'origin-request')]));

      await expect(newUpdater().advanceIfStale(target)).rejects.toThrow(
        `No CloudFront distribution found for edge lambda ${EDGE_ARN}`,
      );

      expect(cloudFrontMock.commandCalls(UpdateDistributionCommand)).toHaveLength(0);
      expect(lambdaMock.commandCalls(TagResourceCommand)).toHaveLength(0);
      expect(console.error).toHaveBeenCalledWith('failed to update edge lambda', {
        edgeLambdaArn: EDGE_ARN,
        error:         `No CloudFront distribution found for edge lambda ${EDGE_ARN}`,
      });
    });

    it('rejects when the distribution configuration comes back without an ETag', async () => {
      taggedDistributions('DIST123');
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
      taggedDistributions('DIST123');
      distributionConfigOf('DIST123', distributionConfig([association(`${EDGE_ARN}:3`, 'origin-request')]));
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
