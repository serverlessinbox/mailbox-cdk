import type { IArtifactResolver }                                  from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                                                from '@serverlessinbox/mailbox-cdk-shared';
import { Duration }                                                from 'aws-cdk-lib';
import { Construct }                                               from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../../contracts/websocket-push';
import type { IDataBlobStore }                                     from '../buckets/data-blob-store';
import { SesNotificationsQueueEvent }                              from '../events/ses-notifications-queue-event';
import type { IAuditEventsQueue }                                  from '../queues/audit-events-queue';
import type { ISesEventQueue }                                     from '../queues/ses-event-queue';
import type { IDataTable }                                         from '../tables/data-tables';

export interface SesEventProcessorLambdaProps {
  itemTable:         IDataTable;
  changelogTable:    IDataTable;
  mailFeedbackTable: IDataTable;
  configTable:       IDataTable;
  blobStore:         IDataBlobStore;
  auditEventsQueue:  IAuditEventsQueue;
  sesEventQueue:     ISesEventQueue;
  artifactResolver:  IArtifactResolver;
}

/**
 * Consumes the SES-notifications queue via its own SQS event source mapping. Owns both the mapping
 * and the consume grant; no other construct wires this Lambda to a queue.
 */
export class SesEventProcessorLambda extends GoLambda implements IWebSocketPushTarget {
  constructor(scope: Construct, id: string, props: SesEventProcessorLambdaProps) {
    super(scope, id, {
      lambdaId:         'sqs-ses-event-processor',
      pipeline:         'mail-out',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.minutes(5),
      memorySize:       256,
      environment:      {
        ITEM_TABLE_NAME:          props.itemTable.tableName,
        CHANGELOG_TABLE_NAME:     props.changelogTable.tableName,
        MAIL_FEEDBACK_TABLE_NAME: props.mailFeedbackTable.tableName,
        CONFIG_TABLE_NAME:        props.configTable.tableName,
        BLOB_STORE_NAME:          props.blobStore.bucketName,
        AUDIT_EVENTS_QUEUE_URL:   props.auditEventsQueue.queueUrl,
      },
    });

    // Grant permissions
    props.itemTable.grantReadWrite(this);
    props.changelogTable.grantReadWrite(this);
    props.mailFeedbackTable.grantReadWrite(this);
    props.configTable.grantReadWrite(this);
    props.blobStore.grantEmailBlobWrite(this);
    props.auditEventsQueue.grantSend(this);

    props.sesEventQueue.grantConsume(this);

    new SesNotificationsQueueEvent(this, 'ses-notifications-queue', { target: this, queue: props.sesEventQueue });
  }

  public enableWebSocketPush(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }
}
