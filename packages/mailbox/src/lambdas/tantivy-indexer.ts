import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '../utils/go-lambda';
import type { ICdkArtifactResolver } from '../artifacts/cdk-artifact-resolver';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface TantivyIndexerLambdaProps {
  indexBucket: IBucket;
  itemTable: ITable;
  configTable: ITable;
  changelogTable: ITable;
  artifactResolver: ICdkArtifactResolver;
}

export class TantivyIndexerLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: TantivyIndexerLambdaProps) {
    super(scope, id, {
      lambdaId: 'tantivy-indexer',
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
    props.indexBucket.grantReadWrite(this);
    props.itemTable.grantReadData(this);
    props.configTable.grantReadData(this);
    props.changelogTable.grantReadData(this);
  }
}
