/**
 * SearchSection takes over the `search` group node. These tests pin what the section owns: the
 * component tag its subtree carries and the child it places at a fixed id (the path is part of the
 * logical ID of every search resource, so a rename replaces deployed resources).
 */
import { ArtifactZone, PinnedArtifactResolver }        from '@serverlessinbox/artifact-registry-cdk';
import { ServerlessInboxTagKeys }                      from '@serverlessinbox/mailbox-cdk-shared';
import { Template }                                    from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                        from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                                      from 'aws-cdk-lib/aws-s3';
import { CfnResource, TagManager }                     from 'aws-cdk-lib';
import type { Stack }                                  from 'aws-cdk-lib';

import { newDeployerTestStack, TEST_ARTIFACT_VERSION } from '../../../__tests__/deployer-test-helpers';
import { DataBlobStore }                               from '../../../resources/buckets/data-blob-store';
import { DataTable }                                   from '../../../resources/tables/data-tables';
import { SearchSection }                               from '../search-section';

function synthSection(stack: Stack): SearchSection {
  const dataTable = (id: string) => new DataTable(new Table(stack, id, {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  }));
  const section   = new SearchSection(stack, 'search', {
    artifactResolver: new PinnedArtifactResolver({
      packages:         { 'mailbox-go': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL } },
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    }),
    data:             {
      configTable:    dataTable('config-table'),
      itemTable:      dataTable('item-table'),
      changelogTable: dataTable('changelog-table'),
      blobStore:      new DataBlobStore(new Bucket(stack, 'blob-store')),
    },
  });
  Template.fromStack(stack);
  return section;
}

function componentTagsUnder(section: SearchSection): string[] {
  return section.node.findAll()
    .filter((child): child is CfnResource => CfnResource.isCfnResource(child) && TagManager.isTaggable(child))
    .map((resource) => TagManager.isTaggable(resource) ? resource.tags.tagValues()[ServerlessInboxTagKeys.component] : '');
}

describe('SearchSection', () => {
  it('tags every taggable resource under it with the search component', () => {
    const { stack } = newDeployerTestStack();

    const tags = componentTagsUnder(synthSection(stack));

    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags)).toEqual(new Set(['search']));
  });

  it('keeps its child at the id the group node used', () => {
    const { stack } = newDeployerTestStack();

    const section = synthSection(stack);

    expect(section.node.tryFindChild('tantivy-search')).toBeDefined();
  });
});
