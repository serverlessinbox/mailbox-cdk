import type { IArtifactResolver }                                  from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription, GoLambda }                          from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                                                from 'aws-cdk-lib';
import { Construct }                                               from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../../contracts/websocket-push';
import type { IDataBlobStore }                                     from '../buckets/data-blob-store';
import { EmailProcessingQueueEvent }                               from '../events/email-processing-queue-event';
import type { IEmailProcessingQueueConsumer }                      from '../queues/email-processing-queue';
import type { IDataTable }                                         from '../tables/data-tables';

/**
 * The tables and blob store the processor reads and writes, and the email-processing queue it
 * consumes. The caller creates them; this Lambda does not own them.
 */
export interface EmailProcessorLambdaProps {
  readonly configTable:          IDataTable;
  readonly itemTable:            IDataTable;
  readonly changelogTable:       IDataTable;
  readonly blobStore:            IDataBlobStore;
  readonly emailProcessingQueue: IEmailProcessingQueueConsumer;
  readonly artifactResolver:     IArtifactResolver;
}

/**
 * Consumes the email-processing queue via its own SQS event source mapping. Owns both the mapping
 * and the consume grant; no other construct wires this Lambda to a queue.
 */
export class EmailProcessorLambda extends GoLambda implements IWebSocketPushTarget {
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

    props.configTable.grantReadWrite(this);
    props.itemTable.grantReadWrite(this);
    props.changelogTable.grantReadWrite(this);

    props.blobStore.grantIncomingEmailConsume(this);
    props.blobStore.grantEmailBlobWrite(this);

    props.emailProcessingQueue.grantConsume(this);

    new EmailProcessingQueueEvent(this, 'email-processing-queue', { target: this, queue: props.emailProcessingQueue });
  }

  public enableWebSocketPush(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }
}
