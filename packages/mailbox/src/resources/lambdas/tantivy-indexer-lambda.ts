import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }               from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }               from 'aws-cdk-lib';
import { Construct }              from 'constructs';

import type { IDataBlobStore }    from '../buckets/data-blob-store';
import type { IDataTable }        from '../tables/data-tables';

export interface TantivyIndexerLambdaProps {
  indexBucket: IDataBlobStore;
  itemTable: IDataTable;
  configTable: IDataTable;
  changelogTable: IDataTable;
  artifactResolver: IArtifactResolver;
}

export class TantivyIndexerLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: TantivyIndexerLambdaProps) {
    super(scope, id, {
      lambdaId: 'tantivy-indexer',
      pipeline: 'mail-in',
      artifactResolver: props.artifactResolver,
      timeout: Duration.minutes(5),
      memorySize: 1024,
      environment: {
        INDEX_BUCKET_NAME: props.indexBucket.bucketName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
      },
    });

    // Grant permissions
    props.indexBucket.grantSearchIndexReadWrite(this);
    props.itemTable.grantRead(this);
    props.configTable.grantRead(this);
    props.changelogTable.grantRead(this);
  }
}
