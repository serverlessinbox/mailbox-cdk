/**
 * DataSection takes over the `data` group node. These tests pin what the section owns: the component
 * tag its subtree carries (tag-scoped grants and cost reports read it) and the children it places at
 * fixed ids (their paths are part of every resource's logical ID, so a rename replaces deployed
 * resources).
 */
import { ArtifactZone, PinnedArtifactResolver }        from '@serverlessinbox/artifact-registry-cdk';
import { ServerlessInboxTagKeys, StackHelpers }        from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                    from 'aws-cdk-lib/assertions';
import { CfnResource, TagManager }                     from 'aws-cdk-lib';
import type { Stack }                                  from 'aws-cdk-lib';

import { newDeployerTestStack, TEST_ARTIFACT_VERSION } from '../../../__tests__/deployer-test-helpers';
import { DataSection }                                 from '../data-section';

function synthSection(stack: Stack): DataSection {
  const artifactResolver = new PinnedArtifactResolver({
    packages:         {
      'mailbox-go':         { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk':        { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
      'mailbox-cdk-shared': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL },
    },
    location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
    deploymentRegion: stack.region,
  });
  const section          = new DataSection(stack, 'data', {
    artifactResolver,
    deployerType: 'cdk',
    stackHelpers: StackHelpers.getOrCreate(stack, artifactResolver),
  });
  Template.fromStack(stack);
  return section;
}

function componentTagsUnder(section: DataSection): string[] {
  return section.node.findAll()
    .filter((child): child is CfnResource => CfnResource.isCfnResource(child) && TagManager.isTaggable(child))
    .map((resource) => TagManager.isTaggable(resource) ? resource.tags.tagValues()[ServerlessInboxTagKeys.component] : '');
}

describe('DataSection', () => {
  it('tags every taggable resource under it with the data component', () => {
    const { stack } = newDeployerTestStack();

    const tags = componentTagsUnder(synthSection(stack));

    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags)).toEqual(new Set(['data']));
  });

  it('deploys the data stack under a name derived from the deploying stack and derives the bucket-name base from that same name', () => {
    const { stack } = newDeployerTestStack();
    synthSection(stack);

    const template      = Template.fromStack(stack);
    const dataStackName = { 'Fn::Join': ['', [{ Ref: 'AWS::StackName' }, '-data']] };

    template.hasResourceProperties('Custom::MailboxDataDeployer', { stackName: dataStackName });
    template.hasResourceProperties('Custom::StackHelpers', { DataStackName: dataStackName });
  });

  it('keeps its children at the ids the group node used', () => {
    const { stack } = newDeployerTestStack();

    const section = synthSection(stack);

    for (const childId of ['stack-helpers', 'stack-helpers-main-stack', 'data-deployer', 'audit-writing']) {
      expect(section.node.tryFindChild(childId)).toBeDefined();
    }
  });
});
