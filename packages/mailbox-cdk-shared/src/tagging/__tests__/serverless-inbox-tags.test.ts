/**
 * Pins the tags the helpers of this module write. The root stack's id is what tells apart two stacks that
 * were created under the same name, so the base tags must carry the stack's own guid on the root stack and
 * the guid handed in on a sub-stack, never the sub-stack's own. A sub-stack's tag map is what the deployer
 * hands to CloudFormation, so a key spelled differently from the one on resources breaks the correlation.
 */

import { Template }                                                                   from 'aws-cdk-lib/assertions';
import { CfnQueue }                                                                   from 'aws-cdk-lib/aws-sqs';
import { App, Aws, Stack }                                                            from 'aws-cdk-lib';
import * as t                                                                         from 'typanion';

import {
  applyServerlessInboxBaseTags,
  applyServerlessInboxBaseTagsWithDeployerType,
  applyServerlessInboxComponentTag,
  applyServerlessInboxEdgeTags,
  serverlessInboxSubStackTags,
} from '../serverless-inbox-tags';

const STACK_GUID = { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] };

const isTaggedResource = t.isPartial({
  Properties: t.isPartial({
    Tags: t.isArray(t.isPartial({ Key: t.isString(), Value: t.isOneOf([t.isString(), t.isPartial({})]) })),
  }),
});

type Tags = t.InferType<typeof isTaggedResource>['Properties']['Tags'];

function tagsOfResourceIn(stack: Stack): Tags {
  new CfnQueue(stack, 'taggable');
  const queues = Object.values(Template.fromStack(stack).findResources('AWS::SQS::Queue'));
  expect(queues).toHaveLength(1);
  const queue: unknown = queues[0];
  t.assert(queue, isTaggedResource);
  return queue.Properties.Tags;
}

function tagValue(tags: Tags, key: string): unknown {
  return tags.find((tag) => tag.Key === key)?.Value;
}

describe('applyServerlessInboxBaseTags', () => {
  it('tags the root stack’s resources with the root stack’s own guid', () => {
    const stack = new Stack(new App(), 'Root');
    applyServerlessInboxBaseTags(stack, { rootStack: Aws.STACK_NAME });

    expect(tagValue(tagsOfResourceIn(stack), 'serverless-inbox:root-stack-id')).toEqual(STACK_GUID);
  });
});

describe('applyServerlessInboxBaseTagsWithDeployerType', () => {
  it('tags a sub-stack’s resources with the root stack id it is given', () => {
    const stack = new Stack(new App(), 'Child');
    applyServerlessInboxBaseTagsWithDeployerType(stack, { rootStack: 'root' }, 'cfn', 'root-guid');

    expect(tagValue(tagsOfResourceIn(stack), 'serverless-inbox:root-stack-id')).toBe('root-guid');
  });

  it('writes the product, root stack, deployer type and the caller’s extra tags, and drops a blank extra tag', () => {
    const stack = new Stack(new App(), 'Child');
    applyServerlessInboxBaseTagsWithDeployerType(
      stack,
      { product: 'acme', rootStack: 'root', extraTags: { team: ' platform ', blank: '  ' } },
      'cfn',
      'root-guid',
    );

    const tags = tagsOfResourceIn(stack);
    expect(tagValue(tags, 'serverless-inbox:product')).toBe('acme');
    expect(tagValue(tags, 'serverless-inbox:root-stack')).toBe('root');
    expect(tagValue(tags, 'serverless-inbox:deployer_type')).toBe('cfn');
    expect(tagValue(tags, 'team')).toBe('platform');
    expect(tagValue(tags, 'blank')).toBeUndefined();
  });
});

describe('applyServerlessInboxComponentTag', () => {
  it('tags the construct’s resources with its component', () => {
    const stack = new Stack(new App(), 'Root');
    applyServerlessInboxComponentTag(stack, 'search');

    expect(tagValue(tagsOfResourceIn(stack), 'serverless-inbox:component')).toBe('search');
  });
});

describe('applyServerlessInboxEdgeTags', () => {
  it('marks the construct’s resources as edge and records the root stack’s region', () => {
    const stack = new Stack(new App(), 'Edge');
    applyServerlessInboxEdgeTags(stack, { rootRegion: 'eu-west-1' });

    const tags = tagsOfResourceIn(stack);
    expect(tagValue(tags, 'serverless-inbox:edge')).toBe('true');
    expect(tagValue(tags, 'serverless-inbox:root-region')).toBe('eu-west-1');
  });
});

describe('serverlessInboxSubStackTags', () => {
  it('builds the product, root stack, root stack id and stack tags under their canonical keys', () => {
    expect(serverlessInboxSubStackTags({ product: ' acme ', rootStack: 'root', rootStackId: 'root-guid', stack: 'root-data' })).toEqual({
      'serverless-inbox:product': 'acme',
      'serverless-inbox:root-stack': 'root',
      'serverless-inbox:root-stack-id': 'root-guid',
      'serverless-inbox:stack': 'root-data',
    });
  });
});
