/**
 * EmailSection takes over the `email` group node. These tests pin what the section owns: the
 * component tag its subtree carries, the children it places at fixed ids (their paths are part of
 * every resource's logical ID, so a rename replaces deployed resources) and the WebSocket fan-out to
 * the Lambdas that record changelog state.
 */
import { ArtifactZone, PinnedArtifactResolver }        from '@serverlessinbox/artifact-registry-cdk';
import { ServerlessInboxTagKeys }                      from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }                             from 'aws-cdk-lib/assertions';
import { Table, AttributeType }                        from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                                      from 'aws-cdk-lib/aws-s3';
import { CfnResource, TagManager }                     from 'aws-cdk-lib';
import type { Stack }                                  from 'aws-cdk-lib';

import { newDeployerTestStack, TEST_ARTIFACT_VERSION } from '../../../__tests__/deployer-test-helpers';
import { DataBlobStore }                               from '../../../resources/buckets/data-blob-store';
import { AuditEventsQueue }                            from '../../../resources/queues/audit-events-queue';
import { DataTable }                                   from '../../../resources/tables/data-tables';
import type { IWebSocketBroadcastPublisher }           from '../../apis/websocket';
import { EmailSection }                                from '../email-section';

function newSection(stack: Stack): EmailSection {
  const dataTable = (id: string) => new DataTable(new Table(stack, id, {
    partitionKey: { name: 'pk', type: AttributeType.STRING },
  }));
  const bucket    = new Bucket(stack, 'blob-store');

  return new EmailSection(stack, 'email', {
    artifactResolver: new PinnedArtifactResolver({
      packages:         { 'mailbox-go': { version: TEST_ARTIFACT_VERSION, zone: ArtifactZone.REGIONAL } },
      location:         { bucketBase: 'test-artifacts', project: 'serverlessinbox' },
      deploymentRegion: stack.region,
    }),
    data:             {
      configTable:       dataTable('config-table'),
      itemTable:         dataTable('item-table'),
      changelogTable:    dataTable('changelog-table'),
      mailFeedbackTable: dataTable('mail-feedback-table'),
      blobStore:         new DataBlobStore(bucket),
      blobStoreBucket:   bucket,
      auditEventsQueue:  new AuditEventsQueue(stack, 'audit-events-queue'),
    },
  });
}

function componentTagsUnder(section: EmailSection): string[] {
  return section.node.findAll()
    .filter((child): child is CfnResource => CfnResource.isCfnResource(child) && TagManager.isTaggable(child))
    .map((resource) => TagManager.isTaggable(resource) ? resource.tags.tagValues()[ServerlessInboxTagKeys.component] : '');
}

describe('EmailSection', () => {
  it('tags every taggable resource under it with the email component', () => {
    const { stack } = newDeployerTestStack();
    const section   = newSection(stack);

    Template.fromStack(stack);

    const tags = componentTagsUnder(section);
    expect(tags.length).toBeGreaterThan(0);
    expect(new Set(tags)).toEqual(new Set(['email']));
  });

  it('keeps its children at the ids the group node used', () => {
    const { stack } = newDeployerTestStack();

    const section = newSection(stack);

    for (const childId of ['ses-event-processing', 'email-sending', 'ses-rules', 'email-processor-lambda']) {
      expect(section.node.tryFindChild(childId)).toBeDefined();
    }
  });

  it('enableWebSocketPublishing reaches the three Lambdas that record changelog state', () => {
    const { stack }                                 = newDeployerTestStack();
    const section                                   = newSection(stack);
    const broadcaster: IWebSocketBroadcastPublisher = {
      functionName: 'broadcaster-function',
      grantInvoke:  () => undefined,
    };

    section.enableWebSocketPublishing(broadcaster);

    const publishing = Template.fromStack(stack).findResources('AWS::Lambda::Function', {
      Properties: {
        Environment: { Variables: Match.objectLike({ WEBSOCKET_BROADCAST_FUNCTION_NAME: 'broadcaster-function' }) },
      },
    });
    expect(Object.keys(publishing)).toHaveLength(3);
  });
});
