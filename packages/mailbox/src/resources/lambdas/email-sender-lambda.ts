import type { IArtifactResolver }                                  from '@serverlessinbox/artifact-registry-cdk';
import { GoLambda }                                                from '@serverlessinbox/mailbox-cdk-shared';
import { Effect, PolicyStatement }                                 from 'aws-cdk-lib/aws-iam';
import { Aws, Duration }                                           from 'aws-cdk-lib';
import { Construct }                                               from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../../contracts/websocket-push';
import type { IDataBlobStore }                                     from '../buckets/data-blob-store';
import { EmailSubmissionsQueueEvent }                              from '../events/email-submissions-queue-event';
import type { IEmailSendingQueueConsumer }                         from '../queues/email-sending-queue';
import type { IDataTable }                                         from '../tables/data-tables';

export interface EmailSenderLambdaProps {
  configTable:      IDataTable;
  itemTable:        IDataTable;
  changelogTable:   IDataTable;
  blobStore:        IDataBlobStore;
  sesConfigSetName: string;
  submissionQueue:  IEmailSendingQueueConsumer;
  artifactResolver: IArtifactResolver;
}

/**
 * Consumes the email-submissions queue via its own SQS event source mapping. Owns both the mapping
 * and the consume grant; no other construct wires this Lambda to a queue.
 */
export class EmailSenderLambda extends GoLambda implements IWebSocketPushTarget {
  constructor(scope: Construct, id: string, props: EmailSenderLambdaProps) {
    super(scope, id, {
      lambdaId:         'email-sender',
      pipeline:         'mail-out',
      artifactResolver: props.artifactResolver,
      timeout:          Duration.minutes(5),
      memorySize:       512,
      environment:      {
        BLOB_STORE_NAME:      props.blobStore.bucketName,
        CONFIG_TABLE_NAME:    props.configTable.tableName,
        ITEM_TABLE_NAME:      props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        SES_CONFIG_SET_NAME:  props.sesConfigSetName,
      },
    });

    // Grant permissions
    props.configTable.grantRead(this);
    props.itemTable.grantReadWrite(this);
    props.changelogTable.grantReadWrite(this);
    props.blobStore.grantEmailBlobRead(this);

    this.grantSesSendRawEmail(props.sesConfigSetName);

    props.submissionQueue.grantConsume(this);

    new EmailSubmissionsQueueEvent(this, 'email-submissions-queue', { target: this, queue: props.submissionQueue });
  }

  public enableWebSocketPush(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }

  private grantSesSendRawEmail(sesConfigSetName: string) {
    // Grant SES send permissions for email identities and the configuration set.
    // SES ignores aws:ResourceTag conditions for SendRawEmail, so we scope by explicit resource ARNs instead.
    this.addToRolePolicy(
      new PolicyStatement({
        effect:    Effect.ALLOW,
        actions:   ['ses:SendRawEmail'],
        resources: [
          `arn:${Aws.PARTITION}:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/*`,
          `arn:${Aws.PARTITION}:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:configuration-set/${sesConfigSetName}`,
        ],
      })
    );
  }
}
