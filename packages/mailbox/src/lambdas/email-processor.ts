import { IBucket } from "aws-cdk-lib/aws-s3";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { GoLambda } from "../utils/go-lambda";
import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs"
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { IWebSocketBroadcastPublisher } from "../api/websocket";

export interface EmailProcessorLambdaProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  blobStore: IBucket;
  artifactResolver: ICdkArtifactEngine;
}

export class EmailProcessorLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: EmailProcessorLambdaProps) {
    super(scope, id, {
      lambdaId: 'email-processor',
      pipeline: 'mail-in',
      artifactResolver: props.artifactResolver,
      timeout: Duration.minutes(1),
      memorySize: 1024,
      environment: {
        BLOB_STORE_NAME: props.blobStore.bucketName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
      },
    });

    // Grant the Lambda function read/write permissions to the DynamoDB tables
    props.configTable.grantReadWriteData(this);
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);

    // Grant the Lambda function permissions to read from the S3 bucket
    props.blobStore.grantReadWrite(this);
  }

  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }
}