import { Construct } from 'constructs';
import { EmailSenderLambda } from '../../lambdas';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { BaseQueue, type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../../api/websocket/websocket';
import { EmailSendingQueue, type IEmailSendingQueue } from './email-sending-queue';

export interface EmailSendingProps {
  readonly configTable: ITable;
  readonly itemTable: ITable;
  readonly changelogTable: ITable;
  readonly blobStore: IBucket;
  readonly artifactResolver: ICdkArtifactEngine;
  readonly sesConfigSetName: string;

  /** Optional default props applied to all queues created by this construct (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Email Sending Infrastructure
 *
 * Creates the SQS queue for email submissions with a DLQ.
 * SES event processing is handled by the separate SESEventProcessing module.
 */
export class EmailSending extends Construct {
  public readonly submissionQueue: BaseQueue;
  public readonly submissionDlq: BaseQueue;
  public readonly submissionQueueAccess: IEmailSendingQueue;
  private readonly emailSenderLambda: IWebSocketPushTarget;

  constructor(scope: Construct, id: string, props: EmailSendingProps) {
    super(scope, id);

    // Queue for email submissions, with its dead-letter queue (retries up to 5 times before
    // sending to the DLQ, which retains failed messages for 14 days).
    const submissionQueue = new EmailSendingQueue(this, 'email-submissions-queue', {
      queueProps: props.queueProps,
    });
    this.submissionQueueAccess = submissionQueue;
    this.submissionDlq = submissionQueue.dlq;
    this.submissionQueue = submissionQueue.queue;

    // Email Sender Lambda - processes submissions from SQS and sends via SES
    const emailSenderLambda = new EmailSenderLambda(this, 'email-sender', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      blobStore: props.blobStore,
      sesConfigSetName: props.sesConfigSetName,
      artifactResolver: props.artifactResolver,
    });

    emailSenderLambda.addEventSource(
      new SqsEventSource(this.submissionQueue, { batchSize: 1 })
    );

    this.emailSenderLambda = emailSenderLambda;
  }

  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.emailSenderLambda.enableWebSocketPush(broadcaster);
  }
}
