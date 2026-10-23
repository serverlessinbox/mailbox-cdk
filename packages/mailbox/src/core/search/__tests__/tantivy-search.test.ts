/**
 * TantivySearch owns the indexer Lambda and the dead-letter queue of its schedule. These tests pin what
 * the construct adds: the index bucket and tables it hands the indexer, the dead-letter queue it wires
 * as the schedule's failure target, and the queue props it passes through.
 */
import type { BaseQueueProps }  from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }      from 'aws-cdk-lib/assertions';
import { AttributeType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }               from 'aws-cdk-lib/aws-s3';
import { QueueEncryption }      from 'aws-cdk-lib/aws-sqs';
import type { Stack }           from 'aws-cdk-lib';

import { newDeployerTestStack } from '../../../__tests__/deployer-test-helpers';
import { DataBlobStore }        from '../../../resources/buckets/data-blob-store';
import { DataTable }            from '../../../resources/tables/data-tables';
import { TantivySearch }        from '../tantivy-search';

interface SynthesizedSearch {
  readonly template:     Template;
  readonly dlqLogicalId: string;
}

function newTable(stack: Stack, id: string): DataTable {
  return new DataTable(new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));
}

function synthSearch(queueProps?: Partial<BaseQueueProps>): SynthesizedSearch {
  const { stack, artifactResolver } = newDeployerTestStack();
  const indexBucket                 = new DataBlobStore(new Bucket(stack, 'index-bucket'));
  new TantivySearch(stack, 'tantivy-search', {
    indexBucket,
    itemTable:      newTable(stack, 'item-source'),
    configTable:    newTable(stack, 'config-source'),
    changelogTable: newTable(stack, 'changelog-source'),
    artifactResolver,
    queueProps,
  });
  const template      = Template.fromStack(stack);
  const dlqLogicalIds = Object.keys(template.findResources('AWS::SQS::Queue'));
  expect(dlqLogicalIds).toHaveLength(1);
  return { template, dlqLogicalId: dlqLogicalIds[0] ?? '' };
}

describe('TantivySearch', () => {
  it('gives the indexer the index bucket and the three tables it reads', () => {
    const { template } = synthSearch();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          INDEX_BUCKET_NAME:    { Ref: Match.stringLikeRegexp('^indexbucket') },
          ITEM_TABLE_NAME:      { Ref: Match.stringLikeRegexp('^itemsource') },
          CONFIG_TABLE_NAME:    { Ref: Match.stringLikeRegexp('^configsource') },
          CHANGELOG_TABLE_NAME: { Ref: Match.stringLikeRegexp('^changelogsource') },
        },
      },
    });
  });

  it('sends the indexing schedule failures to the dead-letter queue it creates', () => {
    const { template, dlqLogicalId } = synthSearch();

    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([
        Match.objectLike({ DeadLetterConfig: { Arn: { 'Fn::GetAtt': [dlqLogicalId, 'Arn'] } } }),
      ]),
    });
  });

  it('applies the queue props it is given to the dead-letter queue', () => {
    const { template } = synthSearch({ encryption: QueueEncryption.UNENCRYPTED });

    template.allResourcesProperties('AWS::SQS::Queue', { SqsManagedSseEnabled: false });
  });
});
