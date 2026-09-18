import { Construct } from 'constructs';
import { EmailSenderLambda } from '../../lambdas';
import type { IDataTable } from '../../data/data-tables';
import type { IDataBlobStore } from '../../data/data-blob-store';
import { type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../../api/websocket/websocket';
import { EmailSendingQueue, type IEmailSendingQueue } from './email-sending-queue';

export interface EmailSendingProps {
  readonly configTable: IDataTable;
  readonly itemTable: IDataTable;
  readonly changelogTable: IDataTable;
  readonly blobStore: IDataBlobStore;
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
  /** Send/consume handle to the email-submissions queue; grant methods only, no raw SQS object. */
  public readonly submissionQueue: IEmailSendingQueue;
  private readonly emailSenderLambda: IWebSocketPushTarget;

  constructor(scope: Construct, id: string, props: EmailSendingProps) {
    super(scope, id);

    // Queue for email submissions, with its dead-letter queue (retries up to 5 times before
    // sending to the DLQ, which retains failed messages for 14 days).
    const submissionQueue = new EmailSendingQueue(this, 'email-submissions-queue', {
      queueProps: props.queueProps,
    });
    this.submissionQueue = submissionQueue;

    // Email Sender Lambda - processes submissions from SQS and sends via SES
    const emailSenderLambda = new EmailSenderLambda(this, 'email-sender', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      blobStore: props.blobStore,
      sesConfigSetName: props.sesConfigSetName,
      submissionQueue,
      artifactResolver: props.artifactResolver,
    });

    this.emailSenderLambda = emailSenderLambda;
  }

  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.emailSenderLambda.enableWebSocketPush(broadcaster);
  }
}
