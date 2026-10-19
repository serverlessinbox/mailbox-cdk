import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { addServerlessInboxResourceGroup } from '../resource-group';

/**
 * Pins the resource group's tag query and the description charset. AWS rejects a description outside
 * `[\sa-zA-Z0-9_.-]*`, which only a deploy reveals, so the literal is held to that set here.
 */
function groupResourceIn(stack: Stack): Record<string, unknown> {
  const groups = Object.values(Template.fromStack(stack).findResources('AWS::ResourceGroups::Group'));
  expect(groups).toHaveLength(1);
  return groups[0].Properties;
}

describe('addServerlessInboxResourceGroup', () => {
  it('matches the stack\'s own root-stack tag and is named after the stack by default', () => {
    const stack = new Stack(new App(), 'TestStack');
    addServerlessInboxResourceGroup(stack, 'resource-group');

    expect(groupResourceIn(stack)).toMatchObject({
      Name: { 'Fn::Join': ['', [{ Ref: 'AWS::StackName' }, '-serverless-inbox']] },
      ResourceQuery: {
        Type: 'TAG_FILTERS_1_0',
        Query: {
          ResourceTypeFilters: ['AWS::AllSupported'],
          TagFilters: [{ Key: 'serverless-inbox:root-stack', Values: [{ Ref: 'AWS::StackName' }] }],
        },
      },
    });
  });

  it('uses the given root-stack value and group name', () => {
    const stack = new Stack(new App(), 'TestStack');
    addServerlessInboxResourceGroup(stack, 'resource-group', { rootStackValue: 'root', groupName: 'custom-group' });

    expect(groupResourceIn(stack)).toMatchObject({
      Name: 'custom-group',
      ResourceQuery: { Query: { TagFilters: [{ Key: 'serverless-inbox:root-stack', Values: ['root'] }] } },
    });
  });

  it('keeps the description within the characters AWS accepts', () => {
    const stack = new Stack(new App(), 'TestStack');
    addServerlessInboxResourceGroup(stack, 'resource-group');

    expect(groupResourceIn(stack).Description).toMatch(/^[\sa-zA-Z0-9_.-]*$/);
  });
});
