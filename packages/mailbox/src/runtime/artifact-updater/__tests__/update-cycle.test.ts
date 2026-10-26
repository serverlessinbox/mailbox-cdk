/// <reference types="jest" />

/**
 * Pins how one scan decides which resources to update and by which path: only resources that opted in and
 * carry their artifact tags are touched, each goes to the updater its type names, and one failing resource
 * must not stop the others from being updated. The three updaters have their own suites and are faked here.
 */

import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
  type ResourceTagMapping,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { ServerlessInboxTagKeys }                                                             from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { mockClient }                                                                         from 'aws-sdk-client-mock';

import { buildUpdaterParts, DISTRIBUTION_ARN, LAMBDA_ARN, lambdaTarget, uiTarget, US_WEST_2 } from './updater-helpers';

jest.mock('../lambda-code/lambda-code-updater');
jest.mock('../edge-lambda-updater');
jest.mock('../ui-bucket-updater');

function resource(arn: string, tags: Record<string, string>): ResourceTagMapping {
  return {
    ResourceARN: arn,
    Tags:        Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
  };
}

function lambdaWithType(autoUpdateType: string, arn: string = LAMBDA_ARN): ResourceTagMapping {
  return resource(arn, {
    [ServerlessInboxTagKeys.rootStack]:       'my-stack',
    [ServerlessInboxTagKeys.rootStackId]:     'guid-1',
    [ServerlessInboxTagKeys.artifactPackage]: 'mailbox-go',
    [ServerlessInboxTagKeys.artifactName]:    'mailbox-go',
    [ServerlessInboxTagKeys.artifactVersion]: '1.2.3',
    [ServerlessInboxTagKeys.autoUpdateType]:  autoUpdateType,
  });
}

function distributionWithType(autoUpdateType: string, bucketName?: string): ResourceTagMapping {
  return resource(DISTRIBUTION_ARN, {
    [ServerlessInboxTagKeys.rootStack]:       'my-stack',
    [ServerlessInboxTagKeys.rootStackId]:     'guid-1',
    [ServerlessInboxTagKeys.artifactPackage]: 'ui-bundle',
    [ServerlessInboxTagKeys.artifactName]:    'ui-bundle.zip',
    [ServerlessInboxTagKeys.artifactVersion]: '1.2.3',
    [ServerlessInboxTagKeys.autoUpdateType]:  autoUpdateType,
    ...(bucketName ? { [ServerlessInboxTagKeys.bucketName]: bucketName } : {}),
  });
}

describe('UpdateCycle', () => {
  const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);

  beforeEach(() => {
    jest.clearAllMocks();
    taggingMock.reset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('scanning', () => {
    it('looks only at lambda functions and CloudFront distributions', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [] });

      await buildUpdaterParts().cycle.run();

      const typeFilters = taggingMock.commandCalls(GetResourcesCommand).map((call) => call.args[0].input.ResourceTypeFilters);
      expect(typeFilters.length).toBeGreaterThan(0);
      for (const filter of typeFilters) {
        expect(filter).toEqual(['lambda:function', 'cloudfront:distribution']);
      }
    });

    it('scans the deployment region and the edge region when they differ', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [] });
      const { cycle, clients } = buildUpdaterParts({ deploymentRegion: US_WEST_2 });

      await cycle.run();

      const scanned = new Set(taggingMock.calls().map((call): unknown => call.thisValue));
      expect(scanned).toEqual(new Set([clients.deployment.tagging, clients.edge.tagging]));
    });

    it('scans the region once when the deployment region is the edge region', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [] });

      await buildUpdaterParts().cycle.run();
      const callsForOneRegion = taggingMock.calls().length;
      taggingMock.resetHistory();

      await buildUpdaterParts({ deploymentRegion: US_WEST_2 }).cycle.run();

      expect(callsForOneRegion).toBeGreaterThan(0);
      expect(taggingMock.calls()).toHaveLength(2 * callsForOneRegion);
    });

    it('rejects and logs when the scan itself fails', async () => {
      taggingMock.on(GetResourcesCommand).rejects(new Error('ThrottlingException'));

      await expect(buildUpdaterParts().cycle.run()).rejects.toThrow('ThrottlingException');

      expect(console.error).toHaveBeenCalledWith('artifact update cycle failed', { error: 'ThrottlingException' });
    });
  });

  describe('which resources are updated', () => {
    it.each([
      { state: 'opted out', skipped: lambdaWithType('none') },
      {
        state:   'opted out and carrying no artifact tags',
        skipped: resource(LAMBDA_ARN, { [ServerlessInboxTagKeys.autoUpdateType]: 'none' }),
      },
      {
        state:   'untagged, which defaults to opted out',
        skipped: resource(LAMBDA_ARN, { [ServerlessInboxTagKeys.rootStack]: 'my-stack' }),
      },
    ])('skips a resource that is $state, before looking at its artifact tags', async ({ skipped }) => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [skipped] });
      const { cycle, codeUpdater, edgeUpdater, uiUpdater } = buildUpdaterParts();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(edgeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(uiUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('skipping auto-update-type=none', { arn: LAMBDA_ARN });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it.each([
      ServerlessInboxTagKeys.artifactPackage,
      ServerlessInboxTagKeys.artifactName,
      ServerlessInboxTagKeys.artifactVersion,
    ])('skips an opted-in resource that lacks the tag %s', async (missingTag) => {
      const incomplete = lambdaWithType('code');
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [{ ...incomplete, Tags: incomplete.Tags?.filter((tag) => tag.Key !== missingTag) }],
      });
      const { cycle, codeUpdater } = buildUpdaterParts();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        'resource missing artifact tags',
        expect.objectContaining({ arn: LAMBDA_ARN, resourceType: 'lambda' }),
      );
    });

    it.each([
      { kind: 'function', resource: lambdaWithType('canary'), resourceType: 'lambda' },
      { kind: 'distribution', resource: distributionWithType('canary', 'ui-content-bucket'), resourceType: 'cloudfront' },
    ])('skips a $kind whose auto-update-type is none of the types it knows, and says so at debug level', async ({ resource: unknownType, resourceType }) => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [unknownType] });
      const { cycle, codeUpdater, edgeUpdater, uiUpdater } = buildUpdaterParts();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(edgeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(uiUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('unknown auto-update-type', {
        arn:          unknownType.ResourceARN,
        resourceType,
        type:         'canary',
      });
    });

    it('skips a resource in the response that has no ARN', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [{ ...lambdaWithType('code'), ResourceARN: undefined }] });
      const { cycle, codeUpdater } = buildUpdaterParts();

      await expect(cycle.run()).resolves.toBeUndefined();

      expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(console.debug).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('skips a resource of a service the updater does not manage, and says so at debug level', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [lambdaWithType('code', 'arn:aws:s3:::some-bucket')],
      });
      const { cycle, codeUpdater } = buildUpdaterParts();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('unknown resource type', {
        arn:          'arn:aws:s3:::some-bucket',
        resourceType: 's3',
      });
    });
  });

  describe('a resource whose ARN is malformed', () => {
    it('is skipped as a resource of an unknown service, and the scan goes on', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [lambdaWithType('code', 'not-an-arn'), lambdaWithType('code')],
      });
      const { cycle, codeUpdater } = buildUpdaterParts();

      await expect(cycle.run()).resolves.toBeUndefined();

      expect(codeUpdater.advanceIfStale).toHaveBeenCalledTimes(1);
      expect(console.debug).toHaveBeenCalledWith('unknown resource type', {
        arn:          'not-an-arn',
        resourceType: undefined,
      });
    });
  });

  describe('which updater a resource goes to', () => {
    it('sends a code function to the code updater with the region it was found in', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [lambdaWithType('code')] });
      const { cycle, clients, codeUpdater } = buildUpdaterParts();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).toHaveBeenCalledWith(clients.deployment, lambdaTarget());
    });

    it('sends an edge function found in the edge region to the edge updater', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [lambdaWithType('edge')] });
      const { cycle, edgeUpdater, codeUpdater } = buildUpdaterParts();

      await cycle.run();

      expect(edgeUpdater.advanceIfStale).toHaveBeenCalledWith(lambdaTarget());
      expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
    });

    it('leaves an edge function found outside the edge region alone', async () => {
      taggingMock
        .on(GetResourcesCommand)
        .resolvesOnce({ ResourceTagMappingList: [lambdaWithType('edge')] })
        .resolves({ ResourceTagMappingList: [] });
      const { cycle, edgeUpdater } = buildUpdaterParts({ deploymentRegion: US_WEST_2 });

      await cycle.run();

      expect(edgeUpdater.advanceIfStale).not.toHaveBeenCalled();
    });

    it('leaves a function of an unknown update type alone, and says so at debug level', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [lambdaWithType('ui')] });
      const { cycle, codeUpdater, edgeUpdater } = buildUpdaterParts();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(edgeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('unknown auto-update-type for lambda', { arn: LAMBDA_ARN, type: 'ui' });
    });

    it('sends a ui distribution to the UI updater with the bucket named in its tags', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [distributionWithType('ui', 'ui-content-bucket')],
      });
      const { cycle, uiUpdater } = buildUpdaterParts();

      await cycle.run();

      expect(uiUpdater.advanceIfStale).toHaveBeenCalledWith(uiTarget());
    });

    it.each([
      { kind: 'a ui distribution without a bucket-name tag', distribution: distributionWithType('ui') },
      { kind: 'a distribution of another update type', distribution: distributionWithType('code', 'ui-content-bucket') },
    ])('leaves $kind alone', async ({ distribution }) => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [distribution] });
      const { cycle, uiUpdater } = buildUpdaterParts();

      await cycle.run();

      expect(uiUpdater.advanceIfStale).not.toHaveBeenCalled();
    });
  });

  describe('when an update fails', () => {
    it('logs it and still updates the other resources', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          lambdaWithType('code'),
          lambdaWithType('code', 'arn:aws:lambda:us-east-1:123456789012:function:admin-api'),
        ],
      });
      const { cycle, codeUpdater } = buildUpdaterParts();
      jest.mocked(codeUpdater.advanceIfStale).mockRejectedValueOnce(new Error('UpdateFunctionCode failed'));

      await expect(cycle.run()).resolves.toBeUndefined();

      expect(codeUpdater.advanceIfStale).toHaveBeenCalledTimes(2);
      expect(console.error).toHaveBeenCalledWith('failed to update resource', {
        arn:   LAMBDA_ARN,
        error: 'UpdateFunctionCode failed',
      });
      expect(console.info).toHaveBeenCalledWith('artifact update cycle completed', { attempted: 2, failed: 1 });
    });

    it('fails the cycle when every resource it tried failed, after trying them all', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [
          lambdaWithType('code'),
          lambdaWithType('code', 'arn:aws:lambda:us-east-1:123456789012:function:admin-api'),
        ],
      });
      const { cycle, codeUpdater } = buildUpdaterParts();
      jest
        .mocked(codeUpdater.advanceIfStale)
        .mockRejectedValueOnce(new Error('UpdateFunctionCode failed'))
        .mockRejectedValueOnce(new Error('UpdateFunctionCode failed'));

      await expect(cycle.run()).rejects.toThrow('all 2 resource updates failed');

      expect(codeUpdater.advanceIfStale).toHaveBeenCalledTimes(2);
      expect(console.error).toHaveBeenCalledWith('artifact update cycle failed', { error: 'all 2 resource updates failed' });
    });

    it('does not count a resource no updater takes as an update that worked', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [lambdaWithType('code'), lambdaWithType('ui', 'arn:aws:lambda:us-east-1:123456789012:function:admin-api')],
      });
      const { cycle, codeUpdater } = buildUpdaterParts();
      jest.mocked(codeUpdater.advanceIfStale).mockRejectedValueOnce(new Error('UpdateFunctionCode failed'));

      await expect(cycle.run()).rejects.toThrow('all 1 resource updates failed');
    });

    it('logs a resource whose ARN is not of the kind its type names, and still updates the others', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [lambdaWithType('code', 'arn:aws:lambda:us-east-1:123456789012:layer:shared:3'), lambdaWithType('code')],
      });
      const { cycle, codeUpdater } = buildUpdaterParts();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(
        'failed to update resource',
        expect.objectContaining({ arn: 'arn:aws:lambda:us-east-1:123456789012:layer:shared:3' }),
      );
    });
  });
});
