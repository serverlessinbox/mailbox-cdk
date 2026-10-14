/// <reference types="jest" />

/**
 * Pins how one scan decides which resources to update and by which path: only resources that opted in and
 * carry their artifact tags are touched, each goes to the updater its type names, and one failing resource
 * must not stop the others from being updated. The three updaters have their own suites and are faked here.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
  type ResourceTagMapping,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { LoggerBuffer } from '@serverlessinbox/mailbox-cdk-shared/lambda-runtime';
import { EdgeLambdaUpdater } from '../edge-lambda-updater';
import { FunctionSmokeTester } from '../function-smoke-tester';
import { LambdaCodeRollback } from '../lambda-code-rollback';
import { LambdaCodeUpdater } from '../lambda-code-updater';
import { LambdaFunctionCode } from '../lambda-function-code';
import { ReleaseArtifacts } from '../release-artifacts';
import { UiBucketUpdater } from '../ui-bucket-updater';
import { UpdateCycle } from '../update-cycle';
import {
  DISTRIBUTION_ARN,
  LAMBDA_ARN,
  fakeUpdaterClients,
  lambdaTarget,
  noSleep,
  testConfig,
  uiTarget,
} from './updater-helpers';

jest.mock('../lambda-code-updater');
jest.mock('../edge-lambda-updater');
jest.mock('../ui-bucket-updater');

function resource(arn: string, tags: Record<string, string>): ResourceTagMapping {
  return {
    ResourceARN: arn,
    Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
  };
}

function lambdaWithType(autoUpdateType: string, arn: string = LAMBDA_ARN): ResourceTagMapping {
  return resource(arn, {
    'serverless-inbox:root-stack': 'my-stack',
    'serverless-inbox:artifact-package': 'mailbox-go',
    'serverless-inbox:artifact-name': 'mailbox-go',
    'serverless-inbox:artifact-version': '1.2.3',
    'serverless-inbox:auto-update-type': autoUpdateType,
  });
}

function distributionWithType(autoUpdateType: string, bucketName?: string): ResourceTagMapping {
  return resource(DISTRIBUTION_ARN, {
    'serverless-inbox:root-stack': 'my-stack',
    'serverless-inbox:artifact-package': 'ui-bundle',
    'serverless-inbox:artifact-name': 'ui-bundle.zip',
    'serverless-inbox:artifact-version': '1.2.3',
    'serverless-inbox:auto-update-type': autoUpdateType,
    ...(bucketName ? { 'serverless-inbox:bucket-name': bucketName } : {}),
  });
}

describe('UpdateCycle', () => {
  const taggingMock = mockClient(ResourceGroupsTaggingAPIClient);

  function newCycle(deploymentRegion?: string) {
    const clients = fakeUpdaterClients(deploymentRegion);
    const logger = new LoggerBuffer(undefined, 'debug');
    const releases = new ReleaseArtifacts(clients.registryS3, testConfig, logger);
    const functionCode = new LambdaFunctionCode(noSleep);
    const smokeTester = new FunctionSmokeTester(logger);
    const rollback = new LambdaCodeRollback(functionCode, logger);
    const codeUpdater = new LambdaCodeUpdater(releases, functionCode, smokeTester, rollback, logger);
    const edgeUpdater = new EdgeLambdaUpdater(
      clients.edge,
      clients.cloudFront,
      releases,
      functionCode,
      smokeTester,
      rollback,
      logger,
      noSleep,
    );
    const uiUpdater = new UiBucketUpdater(clients.registryS3, clients.deployment, clients.cloudFront, releases, logger);
    const cycle = new UpdateCycle(testConfig, clients, logger, codeUpdater, edgeUpdater, uiUpdater);
    return { cycle, clients, codeUpdater, edgeUpdater, uiUpdater };
  }

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
    it('asks for the lambda functions and distributions that carry the root stack tag', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [] });

      await newCycle().cycle.run();

      expect(taggingMock.commandCalls(GetResourcesCommand)[0].args[0].input).toEqual({
        TagFilters: [{ Key: 'serverless-inbox:root-stack', Values: ['my-stack'] }],
        ResourceTypeFilters: ['lambda:function', 'cloudfront:distribution'],
        PaginationToken: undefined,
      });
    });

    it('scans the deployment region and the edge region when they differ', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [] });
      const { cycle, clients } = newCycle('us-west-2');

      await cycle.run();

      const scanned = taggingMock.calls().map((call) => call.thisValue);
      expect(scanned).toEqual([clients.deployment.tagging, clients.edge.tagging]);
    });

    it('scans the region once when the deployment region is the edge region', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [] });

      await newCycle().cycle.run();

      expect(taggingMock.commandCalls(GetResourcesCommand)).toHaveLength(1);
    });

    it('follows the pagination token to process every page', async () => {
      taggingMock
        .on(GetResourcesCommand)
        .resolvesOnce({ ResourceTagMappingList: [lambdaWithType('code')], PaginationToken: 'page-2' })
        .resolvesOnce({
          ResourceTagMappingList: [lambdaWithType('code', 'arn:aws:lambda:us-east-1:123456789012:function:admin-api')],
        });
      const { cycle, codeUpdater } = newCycle();

      await cycle.run();

      expect(taggingMock.commandCalls(GetResourcesCommand)[1].args[0].input.PaginationToken).toBe('page-2');
      expect(codeUpdater.advanceIfStale).toHaveBeenCalledTimes(2);
    });

    it('rejects and logs when the scan itself fails', async () => {
      taggingMock.on(GetResourcesCommand).rejects(new Error('ThrottlingException'));

      await expect(newCycle().cycle.run()).rejects.toThrow('ThrottlingException');

      expect(console.error).toHaveBeenCalledWith('artifact update cycle failed', { error: 'ThrottlingException' });
    });
  });

  describe('which resources are updated', () => {
    it.each([
      ['opted out', lambdaWithType('none')],
      ['opted out and carrying no artifact tags', resource(LAMBDA_ARN, { 'serverless-inbox:auto-update-type': 'none' })],
      ['untagged, which defaults to opted out', resource(LAMBDA_ARN, { 'serverless-inbox:root-stack': 'my-stack' })],
    ])('skips a resource that is %s, before looking at its artifact tags', async (_description, skipped) => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [skipped] });
      const { cycle, codeUpdater, edgeUpdater, uiUpdater } = newCycle();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(edgeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(uiUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('skipping auto-update-type=none', { arn: LAMBDA_ARN });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it.each(['serverless-inbox:artifact-package', 'serverless-inbox:artifact-name', 'serverless-inbox:artifact-version'])(
      'skips an opted-in resource that lacks the tag %s',
      async (missingTag) => {
        const incomplete = lambdaWithType('code');
        taggingMock.on(GetResourcesCommand).resolves({
          ResourceTagMappingList: [{ ...incomplete, Tags: incomplete.Tags?.filter((tag) => tag.Key !== missingTag) }],
        });
        const { cycle, codeUpdater } = newCycle();

        await cycle.run();

        expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith(
          'resource missing artifact tags',
          expect.objectContaining({ arn: LAMBDA_ARN, resourceType: 'lambda' }),
        );
      },
    );

    it('skips a resource in the response that has no ARN', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [{ Tags: [] }] });

      await expect(newCycle().cycle.run()).resolves.toBeUndefined();
    });

    it('skips a resource of a service the updater does not manage, and says so at debug level', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [lambdaWithType('code', 'arn:aws:s3:::some-bucket')],
      });
      const { cycle, codeUpdater } = newCycle();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('unknown resource type', {
        arn: 'arn:aws:s3:::some-bucket',
        resourceType: 's3',
      });
    });
  });

  describe('a resource whose ARN is malformed', () => {
    it('is skipped as a resource of an unknown service, and the scan goes on', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [lambdaWithType('code', 'not-an-arn'), lambdaWithType('code')],
      });
      const { cycle, codeUpdater } = newCycle();

      await expect(cycle.run()).resolves.toBeUndefined();

      expect(codeUpdater.advanceIfStale).toHaveBeenCalledTimes(1);
      expect(console.debug).toHaveBeenCalledWith('unknown resource type', {
        arn: 'not-an-arn',
        resourceType: undefined,
      });
    });
  });

  describe('which updater a resource goes to', () => {
    it('sends a code function to the code updater with the region it was found in', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [lambdaWithType('code')] });
      const { cycle, clients, codeUpdater } = newCycle();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).toHaveBeenCalledWith(clients.deployment, lambdaTarget());
    });

    it('sends an edge function found in the edge region to the edge updater', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [lambdaWithType('edge')] });
      const { cycle, edgeUpdater, codeUpdater } = newCycle();

      await cycle.run();

      expect(edgeUpdater.advanceIfStale).toHaveBeenCalledWith(lambdaTarget());
      expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
    });

    it('leaves an edge function found outside the edge region alone', async () => {
      taggingMock
        .on(GetResourcesCommand)
        .resolvesOnce({ ResourceTagMappingList: [lambdaWithType('edge')] })
        .resolves({ ResourceTagMappingList: [] });
      const { cycle, edgeUpdater } = newCycle('us-west-2');

      await cycle.run();

      expect(edgeUpdater.advanceIfStale).not.toHaveBeenCalled();
    });

    it('leaves a function of an unknown update type alone, and says so at debug level', async () => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [lambdaWithType('ui')] });
      const { cycle, codeUpdater, edgeUpdater } = newCycle();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(edgeUpdater.advanceIfStale).not.toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('unknown auto-update-type for lambda', { arn: LAMBDA_ARN, type: 'ui' });
    });

    it('sends a ui distribution to the UI updater with the bucket named in its tags', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [distributionWithType('ui', 'ui-content-bucket')],
      });
      const { cycle, uiUpdater } = newCycle();

      await cycle.run();

      expect(uiUpdater.advanceIfStale).toHaveBeenCalledWith(uiTarget());
    });

    it.each([
      ['a ui distribution without a bucket-name tag', distributionWithType('ui')],
      ['a distribution of another update type', distributionWithType('code', 'ui-content-bucket')],
    ])('leaves %s alone', async (_description, distribution) => {
      taggingMock.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [distribution] });
      const { cycle, uiUpdater } = newCycle();

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
      const { cycle, codeUpdater } = newCycle();
      jest.mocked(codeUpdater.advanceIfStale).mockRejectedValueOnce(new Error('UpdateFunctionCode failed'));

      await expect(cycle.run()).resolves.toBeUndefined();

      expect(codeUpdater.advanceIfStale).toHaveBeenCalledTimes(2);
      expect(console.error).toHaveBeenCalledWith('failed to update resource', {
        arn: LAMBDA_ARN,
        error: 'UpdateFunctionCode failed',
      });
    });

    it('logs a resource whose ARN is not of the kind its type names, and still updates the others', async () => {
      taggingMock.on(GetResourcesCommand).resolves({
        ResourceTagMappingList: [lambdaWithType('code', 'arn:aws:lambda:us-east-1:123456789012:layer:shared:3'), lambdaWithType('code')],
      });
      const { cycle, codeUpdater } = newCycle();

      await cycle.run();

      expect(codeUpdater.advanceIfStale).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(
        'failed to update resource',
        expect.objectContaining({ arn: 'arn:aws:lambda:us-east-1:123456789012:layer:shared:3' }),
      );
    });
  });
});
