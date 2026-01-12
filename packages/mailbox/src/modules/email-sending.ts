import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EmailSenderLambda } from '../lambdas';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { BaseQueue } from '../utils/base-queue';
import { IArtifactResolver } from '../utils/artifact-resolver';

export interface EmailSendingProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  emailBucket: IBucket;
  artifactResolver: IArtifactResolver;
  sesConfigSetName: string;
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
  public readonly emailSenderLambda: lambda.IFunction;

  constructor(scope: Construct, id: string, props: EmailSendingProps) {
    super(scope, id);

    // Dead Letter Queue for failed email submissions
    this.submissionDlq = new BaseQueue(this, 'SubmissionDLQ', {
      queueName: 'mailbox-email-submissions-dlq',
      // Override retention period for DLQ
      retentionPeriod: Duration.days(14), // Keep failed messages for 14 days
    });

    // Main queue for email submissions
    this.submissionQueue = new BaseQueue(this, 'SubmissionQueue', {
      queueName: 'mailbox-email-submissions',
      deadLetterQueue: {
        queue: this.submissionDlq,
        maxReceiveCount: 5, // Retry up to 5 times before sending to DLQ
      },
    });

    // Email Sender Lambda - processes submissions from SQS and sends via SES
    this.emailSenderLambda = new EmailSenderLambda(this, 'EmailSenderLambda', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      emailBucket: props.emailBucket,
      sesConfigSetName: props.sesConfigSetName,
      artifactResolver: props.artifactResolver,
    });
  }
}
