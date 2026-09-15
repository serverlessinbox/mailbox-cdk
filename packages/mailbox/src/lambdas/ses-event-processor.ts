import { Duration } from 'aws-cdk-lib';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../api/websocket';

export interface SESEventProcessorLambdaProps {
  itemTable: ITable;
  changelogTable: ITable;
  mailFeedbackTable: ITable;
  configTable: ITable;
  blobStore: IBucket;
  auditEventsQueue: IQueue;
  artifactResolver: ICdkArtifactEngine;
}

export class SESEventProcessorLambda extends GoLambda implements IWebSocketPushTarget {
  constructor(scope: Construct, id: string, props: SESEventProcessorLambdaProps) {
    super(scope, id, {
      lambdaId: 'sqs-ses-event-processor',
      pipeline: 'mail-out',
      artifactResolver: props.artifactResolver,
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        MAIL_FEEDBACK_TABLE_NAME: props.mailFeedbackTable.tableName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        BLOB_STORE_NAME: props.blobStore.bucketName,
        AUDIT_EVENTS_QUEUE_URL: props.auditEventsQueue.queueUrl,
      },
    });

    // Grant permissions
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);
    props.mailFeedbackTable.grantReadWriteData(this);
    props.configTable.grantReadWriteData(this);
    props.blobStore.grantReadWrite(this);
    props.auditEventsQueue.grantSendMessages(this);
  }

  public enableWebSocketPush(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }
}
