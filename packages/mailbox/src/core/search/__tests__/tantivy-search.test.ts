/**
 * TantivySearch owns the indexer Lambda and the dead-letter queue of its schedule. These tests pin what
 * the construct adds: the index bucket and tables it hands the indexer, the dead-letter queue it wires
 * as the schedule's failure target, and the encryption it passes through to that queue.
 */
import type { QueueEncryptionChoice } from '@serverlessinbox/mailbox-cdk-shared';
import { Match, Template }            from 'aws-cdk-lib/assertions';
import { AttributeType, Table }       from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                     from 'aws-cdk-lib/aws-s3';
import type { Stack }                 from 'aws-cdk-lib';

import { newDeployerTestStack }       from '../../../__tests__/deployer-test-helpers';
import { DataBlobStore }              from '../../../resources/buckets/data-blob-store';
import { DataTable }                  from '../../../resources/tables/data-tables';
import { TantivySearch }              from '../tantivy-search';

interface SynthesizedSearch {
  readonly template:     Template;
  readonly dlqLogicalId: string;
}

function newTable(stack: Stack, id: string): DataTable {
  return new DataTable(new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));
}

const AWS_MANAGED: QueueEncryptionChoice = { kind: 'aws-managed' };

function synthSearch(queueEncryption: QueueEncryptionChoice): SynthesizedSearch {
  const { stack, artifactResolver } = newDeployerTestStack();
  const indexBucket                 = new DataBlobStore(new Bucket(stack, 'index-bucket'));
  new TantivySearch(stack, 'tantivy-search', {
    indexBucket,
    itemTable:      newTable(stack, 'item-source'),
    configTable:    newTable(stack, 'config-source'),
    changelogTable: newTable(stack, 'changelog-source'),
    artifactResolver,
    queueEncryption,
  });
  const template      = Template.fromStack(stack);
  const dlqLogicalIds = Object.keys(template.findResources('AWS::SQS::Queue'));
  expect(dlqLogicalIds).toHaveLength(1);
  return { template, dlqLogicalId: dlqLogicalIds[0] ?? '' };
}

describe('TantivySearch', () => {
  it('gives the indexer the index bucket and the three tables it reads', () => {
    const { template } = synthSearch(AWS_MANAGED);

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
    const { template, dlqLogicalId } = synthSearch(AWS_MANAGED);

    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([
        Match.objectLike({ DeadLetterConfig: { Arn: { 'Fn::GetAtt': [dlqLogicalId, 'Arn'] } } }),
      ]),
    });
  });

  it('applies the encryption it is given to the dead-letter queue', () => {
    const { template } = synthSearch({ kind: 'unencrypted' });

    template.allResourcesProperties('AWS::SQS::Queue', { SqsManagedSseEnabled: false });
  });
});
