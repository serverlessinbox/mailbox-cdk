import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EmailSenderLambda } from '../../lambdas';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { BaseQueue, type BaseQueueProps } from '../../utils/base-queue';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../../api/websocket';

export interface EmailSendingProps {
  readonly configTable: ITable;
  readonly itemTable: ITable;
  readonly changelogTable: ITable;
  readonly blobStore: IBucket;
  readonly artifactResolver: ICdkArtifactEngine;
  readonly sesConfigSetName: string;

  /** Optional default props applied to all queues created by this construct (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
  /** IAM tag key used to identify resources belonging to this stack, sourced from the tag-key registry. */
  readonly stackIdentityTagKey: string;
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
  private readonly emailSenderLambda: IWebSocketPushTarget;

  constructor(scope: Construct, id: string, props: EmailSendingProps) {
    super(scope, id);

    const queueProps = props.queueProps ?? {};

    // Dead Letter Queue for failed email submissions
    this.submissionDlq = new BaseQueue(this, 'email-submissions-dlq', {
      ...queueProps,
      // Override retention period for DLQ
      retentionPeriod: Duration.days(14), // Keep failed messages for 14 days
    });

    // Main queue for email submissions
    this.submissionQueue = new BaseQueue(this, 'email-submissions', {
      ...queueProps,
      deadLetterQueue: {
        queue: this.submissionDlq,
        maxReceiveCount: 5, // Retry up to 5 times before sending to DLQ
      },
    });

    // Email Sender Lambda - processes submissions from SQS and sends via SES
    const emailSenderLambda = new EmailSenderLambda(this, 'email-sender', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      blobStore: props.blobStore,
      sesConfigSetName: props.sesConfigSetName,
      artifactResolver: props.artifactResolver,
      stackIdentityTagKey: props.stackIdentityTagKey,
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
