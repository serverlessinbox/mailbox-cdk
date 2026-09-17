import { Aws, Duration } from 'aws-cdk-lib';
import { GoLambda } from '@serverlessinbox/mailbox-cdk-shared';
import { type ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../api/websocket/websocket';
import type { IEmailSendingQueueConsumer } from '../email/sending/email-sending-queue';

export interface EmailSenderLambdaProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  blobStore: IBucket;
  sesConfigSetName: string;
  submissionQueue: IEmailSendingQueueConsumer;
  artifactResolver: ICdkArtifactEngine;
}

/**
 * Consumes the email-submissions queue via its own SQS event source mapping. Owns both the mapping
 * and the consume grant; no other construct wires this Lambda to a queue.
 */
export class EmailSenderLambda extends GoLambda implements IWebSocketPushTarget {
  constructor(scope: Construct, id: string, props: EmailSenderLambdaProps) {
    super(scope, id, {
      lambdaId: 'email-sender',
      pipeline: 'mail-out',
      artifactResolver: props.artifactResolver,
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: {
        BLOB_STORE_NAME: props.blobStore.bucketName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        SES_CONFIG_SET_NAME: props.sesConfigSetName,
      },
    });

    // Grant permissions
    props.configTable.grantReadData(this);
    props.itemTable.grantReadWriteData(this);
    props.changelogTable.grantReadWriteData(this);
    props.blobStore.grantRead(this);

    // Grant SES send permissions for email identities and the configuration set.
    // SES ignores aws:ResourceTag conditions for SendRawEmail, so we scope by explicit resource ARNs instead.
    this.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ses:SendRawEmail'],
        resources: [
          `arn:${Aws.PARTITION}:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:identity/*`,
          `arn:${Aws.PARTITION}:ses:${Aws.REGION}:${Aws.ACCOUNT_ID}:configuration-set/${props.sesConfigSetName}`,
        ],
      })
    );

    this.addEventSourceMapping('email-submissions-queue', {
      eventSourceArn: props.submissionQueue.queueArn,
      batchSize: 1,
    });
    props.submissionQueue.grantConsume(this);
  }

  public enableWebSocketPush(broadcaster: IWebSocketBroadcastPublisher): void {
    this.addEnvironment('WEBSOCKET_BROADCAST_FUNCTION_NAME', broadcaster.functionName);
    broadcaster.grantInvoke(this);
  }
}
