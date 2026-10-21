import type { IArtifactResolver }             from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                           from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                           from 'aws-cdk-lib';
import { Construct }                          from 'constructs'

import type { IWebSocketBroadcastPublisher }  from '../../api/websocket/websocket';
import type { IDataBlobStore }                from '../../data/data-blob-store';
import type { IDataTable }                    from '../tables/data-tables';
import type { IEmailProcessingQueueConsumer } from '../../email/receiving/email-processing-queue';

export interface EmailProcessorLambdaProps {
  configTable: IDataTable;
  itemTable: IDataTable;
  changelogTable: IDataTable;
  blobStore: IDataBlobStore;
  emailProcessingQueue: IEmailProcessingQueueConsumer;
  artifactResolver: IArtifactResolver;
}

/**
 * Consumes the email-processing queue via its own SQS event source mapping. Owns both the mapping
 * and the consume grant; no other construct wires this Lambda to a queue.
 */
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
    props.configTable.grantReadWrite(this);
    props.itemTable.grantReadWrite(this);
    props.changelogTable.grantReadWrite(this);

    // Consume the raw message SES delivered, then write it into standard email-blob storage
    props.blobStore.grantIncomingEmailConsume(this);
    props.blobStore.grantEmailBlobWrite(this);

    this.addEventSourceMapping('email-processing-queue', {
      eventSourceArn: props.emailProcessingQueue.queueArn,
      batchSize: 10,
      reportBatchItemFailures: true,
      maxBatchingWindow: Duration.seconds(15),
    });
    props.emailProcessingQueue.grantConsume(this);
  }

  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }
}