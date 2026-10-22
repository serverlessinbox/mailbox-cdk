import type { IArtifactResolver }             from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription, GoLambda }     from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                           from 'aws-cdk-lib';
import { Construct }                          from 'constructs'

import type { IWebSocketBroadcastPublisher }  from '../../core/apis/websocket';
import type { IDataBlobStore }                from '../buckets/data-blob-store';
import { EmailProcessingQueueEvent }          from '../events/email-processing-queue-event';
import type { IEmailProcessingQueueConsumer } from '../queues/email-processing-queue';
import type { IDataTable }                    from '../tables/data-tables';

export interface EmailProcessorLambdaProps {
  configTable:          IDataTable;
  itemTable:            IDataTable;
  changelogTable:       IDataTable;
  blobStore:            IDataBlobStore;
  emailProcessingQueue: IEmailProcessingQueueConsumer;
  artifactResolver:     IArtifactResolver;
}

/**
 * Consumes the email-processing queue via its own SQS event source mapping. Owns both the mapping
 * and the consume grant; no other construct wires this Lambda to a queue.
 */
export class EmailProcessorLambda extends GoLambda {
  constructor(scope: Construct, id: string, props: EmailProcessorLambdaProps) {
    super(scope, id, {
      lambdaId:         'email-processor',
      pipeline:         'mail-in',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.minutes(1),
      memorySize:       1024,
      environment:      {
        BLOB_STORE_NAME:      props.blobStore.bucketName,
        CONFIG_TABLE_NAME:    props.configTable.tableName,
        ITEM_TABLE_NAME:      props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
      },
    });
    ComponentDescription.describe(this, 'Inbound email processing — parses MIME, stores raw content to S3, and indexes messages into the mailbox.');

    // Grant the Lambda function read/write permissions to the DynamoDB tables
    props.configTable.grantReadWrite(this);
    props.itemTable.grantReadWrite(this);
    props.changelogTable.grantReadWrite(this);

    // Consume the raw message SES delivered, then write it into standard email-blob storage
    props.blobStore.grantIncomingEmailConsume(this);
    props.blobStore.grantEmailBlobWrite(this);

    props.emailProcessingQueue.grantConsume(this);

    new EmailProcessingQueueEvent(this, 'email-processing-queue', { target: this, queue: props.emailProcessingQueue });
  }

  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }
}