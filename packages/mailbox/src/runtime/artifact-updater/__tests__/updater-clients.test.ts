/// <reference types="jest" />

/**
 * Pins how the updater finds the resources a root stack owns: those tagged with its id, plus those with no
 * id tag whose `root-stack` tag holds its name. A resource that carries an id tag naming another stack must
 * never be returned through a matching name, or a stack recreated under the same name would update, and
 * through the updater's grants change, resources it does not own.
 */

import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
  type ResourceTagMapping,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { mockClient }         from 'aws-sdk-client-mock';

import { RootStackResources } from '../updater-clients';

const ID_KEY   = 'serverless-inbox:root-stack-id';
const NAME_KEY = 'serverless-inbox:root-stack';
const TYPES    = ['lambda:function'];

function mapping(arn: string, tags: Record<string, string>): ResourceTagMapping {
  return { ResourceARN: arn, Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) };
}

describe('RootStackResources', () => {
  const taggingMock        = mockClient(ResourceGroupsTaggingAPIClient);
  const tagging            = new ResourceGroupsTaggingAPIClient({ region: 'us-east-1' });
  const rootStackResources = new RootStackResources('my-stack', 'guid-1');

  function answerQuery(tagKey: string, ...pages: ResourceTagMapping[][]): void {
    const matcher  = { TagFilters: [{ Key: tagKey, Values: [tagKey === ID_KEY ? 'guid-1' : 'my-stack'] }] };
    const answers  = pages.map((page, index) => ({
      ResourceTagMappingList: page,
      PaginationToken:        index < pages.length - 1 ? `page-${index + 2}` : '',
    }));
    const behavior = taggingMock.on(GetResourcesCommand, matcher);
    answers.forEach((answer) => behavior.resolvesOnce(answer));
    behavior.resolves({ ResourceTagMappingList: [] });
  }

  beforeEach(() => {
    taggingMock.reset();
  });

  it('returns the resources tagged with the id', async () => {
    const byId = mapping('arn:a', { [ID_KEY]: 'guid-1', [NAME_KEY]: 'my-stack' });
    answerQuery(ID_KEY, [byId]);
    answerQuery(NAME_KEY, [byId]);

    expect(await rootStackResources.find(tagging, TYPES)).toEqual([byId]);
  });

  it('returns a resource with no id tag whose name tag holds the stack name', async () => {
    const byName = mapping('arn:b', { [NAME_KEY]: 'my-stack' });
    answerQuery(ID_KEY, []);
    answerQuery(NAME_KEY, [byName]);

    expect(await rootStackResources.find(tagging, TYPES)).toEqual([byName]);
  });

  it('leaves out a resource whose name tag matches but whose id tag names another stack', async () => {
    const recreatedPredecessor = mapping('arn:c', { [NAME_KEY]: 'my-stack', [ID_KEY]: 'guid-2' });
    answerQuery(ID_KEY, []);
    answerQuery(NAME_KEY, [recreatedPredecessor]);

    expect(await rootStackResources.find(tagging, TYPES)).toEqual([]);
  });

  it('follows the pagination token of each query', async () => {
    const first  = mapping('arn:d', { [ID_KEY]: 'guid-1' });
    const second = mapping('arn:e', { [ID_KEY]: 'guid-1' });
    const third  = mapping('arn:f', { [NAME_KEY]: 'my-stack' });
    answerQuery(ID_KEY, [first], [second]);
    answerQuery(NAME_KEY, [third]);

    expect(await rootStackResources.find(tagging, TYPES)).toEqual([first, second, third]);
    const tokens = taggingMock.commandCalls(GetResourcesCommand).map((call) => call.args[0].input.PaginationToken);
    expect(tokens).toEqual([undefined, 'page-2', undefined]);
  });

  it('asks each query for the given resource types', async () => {
    answerQuery(ID_KEY, []);
    answerQuery(NAME_KEY, []);

    await rootStackResources.find(tagging, ['cloudfront:distribution']);

    const types = taggingMock.commandCalls(GetResourcesCommand).map((call) => call.args[0].input.ResourceTypeFilters);
    expect(types).toEqual([['cloudfront:distribution'], ['cloudfront:distribution']]);
  });
});
