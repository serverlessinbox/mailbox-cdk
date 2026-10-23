import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import type { IQueue }            from 'aws-cdk-lib/aws-sqs';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import type { IDataBlobStore }    from '../buckets/data-blob-store';
import { SearchIndexingSchedule } from '../events/search-indexing-schedule';
import type { IDataTable }        from '../tables/data-tables';

/**
 * The index bucket the indexer writes, the tables it reads, the artifact resolver for its code and the
 * dead-letter queue its schedule uses. The caller creates every resource here.
 */
export interface TantivyIndexerLambdaProps {
  readonly indexBucket:         IDataBlobStore;
  readonly itemTable:           IDataTable;
  readonly configTable:         IDataTable;
  readonly changelogTable:      IDataTable;
  readonly artifactResolver:    IArtifactResolver;
  readonly indexingScheduleDlq: IQueue;
}

/** The Go Lambda that indexes mailbox items into the search index bucket on a schedule. */
export class TantivyIndexerLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: TantivyIndexerLambdaProps) {
    super(scope, id, {
      lambdaId:         'tantivy-indexer',
      pipeline:         'mail-in',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.minutes(5),
      memorySize:       1024,
      environment:      {
        INDEX_BUCKET_NAME:    props.indexBucket.bucketName,
        ITEM_TABLE_NAME:      props.itemTable.tableName,
        CONFIG_TABLE_NAME:    props.configTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
      },
    });

    props.indexBucket.grantSearchIndexReadWrite(this);
    props.itemTable.grantRead(this);
    props.configTable.grantRead(this);
    props.changelogTable.grantRead(this);

    new SearchIndexingSchedule(this, 'indexing-schedule', { target: this, deadLetterQueue: props.indexingScheduleDlq });
  }
}
