/// <reference types="jest" />

/**
 * TantivyIndexerLambda wrapper tests.
 *
 * Pins the environment names the indexer reads by name, and that it reads the item, config and
 * changelog tables without writing them, and reads and writes only the search index in the bucket.
 */

import { actionsOf }                                 from '@serverlessinbox/mailbox-cdk-shared/cdk-test-support';
import { Template }                                  from 'aws-cdk-lib/assertions';
import { AttributeType, Table }                      from 'aws-cdk-lib/aws-dynamodb';
import { Bucket }                                    from 'aws-cdk-lib/aws-s3';
import { Queue }                                     from 'aws-cdk-lib/aws-sqs';

import { DataBlobStore }                             from '../../buckets/data-blob-store';
import { DataTable }                                 from '../../tables/data-tables';
import { TantivyIndexerLambda }                      from '../tantivy-indexer-lambda';

import { arrangeWrapperStack, onlyLambdaOf }         from './lambda-wrapper-helpers';
import type { SynthesizedLambda }                    from './lambda-wrapper-helpers';

function synthesize(): SynthesizedLambda {
  const { stack, artifactResolver } = arrangeWrapperStack();
  const dataTable                   = (id: string): DataTable => new DataTable(new Table(stack, id, { partitionKey: { name: 'pk', type: AttributeType.STRING } }));

  new TantivyIndexerLambda(stack, 'tantivy-indexer', {
    indexBucket:    new DataBlobStore(new Bucket(stack, 'index-bucket')),
    itemTable:      dataTable('item-table'),
    configTable:    dataTable('config-table'),
    changelogTable: dataTable('changelog-table'),
    artifactResolver,
    indexingScheduleDlq: new Queue(stack, 'indexing-schedule-dlq'),
  });

  return onlyLambdaOf(Template.fromStack(stack));
}

describe('TantivyIndexerLambda', () => {
  it('sets the index bucket and the three table names the indexer reads', () => {
    expect(Object.keys(synthesize().environment)).toEqual(expect.arrayContaining([
      'INDEX_BUCKET_NAME',
      'ITEM_TABLE_NAME',
      'CONFIG_TABLE_NAME',
      'CHANGELOG_TABLE_NAME',
    ]));
  });

  it('reads the tables and never writes them', () => {
    const actions = synthesize().statements.flatMap(actionsOf);

    expect(actions).toEqual(expect.arrayContaining(['dynamodb:GetItem', 'dynamodb:Query']));
    expect(actions).not.toContain('dynamodb:PutItem');
    expect(actions).not.toContain('dynamodb:UpdateItem');
  });

  it('reads and writes the search index objects in the bucket', () => {
    const actions = synthesize().statements.flatMap(actionsOf);

    expect(actions).toEqual(expect.arrayContaining(['s3:GetObject', 's3:PutObject']));
  });
});
