import { App, Aws, Stack } from 'aws-cdk-lib';
import { CfnQueue } from 'aws-cdk-lib/aws-sqs';
import { Template } from 'aws-cdk-lib/assertions';
import { applyServerlessInboxBaseTags, applyServerlessInboxBaseTagsWithDeployerType } from '../serverless-inbox-tags';

/**
 * Pins the id tag the base-tag aspect writes. The root stack's id is what tells apart two stacks that
 * were created under the same name, so the tag must carry the stack's own guid on the root stack and
 * the guid handed in on a sub-stack, never the sub-stack's own.
 */

const STACK_GUID = { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] };

function taggedResourceIn(stack: Stack): Record<string, unknown> {
  new CfnQueue(stack, 'taggable');
  const queues = Object.values(Template.fromStack(stack).findResources('AWS::SQS::Queue'));
  expect(queues).toHaveLength(1);
  return queues[0].Properties;
}

function tagValue(properties: Record<string, unknown>, key: string): unknown {
  const tags = properties.Tags as Array<{ Key: string; Value: unknown }>;
  return tags.find((tag) => tag.Key === key)?.Value;
}

describe('applyServerlessInboxBaseTags', () => {
  it('tags the root stack’s resources with the root stack’s own guid', () => {
    const stack = new Stack(new App(), 'Root');
    applyServerlessInboxBaseTags(stack, { rootStack: Aws.STACK_NAME });

    expect(tagValue(taggedResourceIn(stack), 'serverless-inbox:root-stack-id')).toEqual(STACK_GUID);
  });
});

describe('applyServerlessInboxBaseTagsWithDeployerType', () => {
  it('tags a sub-stack’s resources with the root stack id it is given', () => {
    const stack = new Stack(new App(), 'Child');
    applyServerlessInboxBaseTagsWithDeployerType(stack, { rootStack: 'root' }, 'cfn', 'root-guid');

    expect(tagValue(taggedResourceIn(stack), 'serverless-inbox:root-stack-id')).toBe('root-guid');
  });
});
