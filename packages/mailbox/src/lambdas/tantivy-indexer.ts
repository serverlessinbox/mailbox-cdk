import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { IDataTable } from '../data/data-tables';
import type { IDataBlobStore } from '../data/data-blob-store';
import { Construct } from 'constructs';

export interface TantivyIndexerLambdaProps {
  indexBucket: IDataBlobStore;
  itemTable: IDataTable;
  configTable: IDataTable;
  changelogTable: IDataTable;
  artifactResolver: ICdkArtifactEngine;
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
