import { Duration } from 'aws-cdk-lib';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SqsSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { GoLambda } from '../utils/go-lambda';
import { ILambdaCodeProvider } from '../utils/lambda-code-provider';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { CfnConfigurationSet, CfnConfigurationSetEventDestination } from 'aws-cdk-lib/aws-ses';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export interface EmailSendingProps {
  configTable: ITable;
  itemTable: ITable;
  changelogTable: ITable;
  emailBucket: IBucket;
  codeProvider: ILambdaCodeProvider;
}

/**
 * Email Sending Infrastructure
 * 
 * Creates the SQS queues and SNS topics required for the email sending pipeline:
 * - SQS queue for email submissions (with DLQ)
 * - SNS topic for SES notifications (bounce, complaint, delivery)
 * - SQS queue to consume SNS notifications
 */
export class EmailSending extends Construct {
  public readonly submissionQueue: Queue;
  public readonly submissionDlq: Queue;
  public readonly sesNotificationsTopic: Topic;
  public readonly sesNotificationsQueue: Queue;
  public readonly emailSenderLambda: lambda.IFunction;
  public readonly sesConfigSetName: string;

  constructor(scope: Construct, id: string, props: EmailSendingProps) {
    super(scope, id);

    // Dead Letter Queue for failed email submissions
    this.submissionDlq = new Queue(this, 'SubmissionDLQ', {
      queueName: 'mailbox-email-submissions-dlq',
      retentionPeriod: Duration.days(14), // Keep failed messages for 14 days
    });

    // Main queue for email submissions
    this.submissionQueue = new Queue(this, 'SubmissionQueue', {
      queueName: 'mailbox-email-submissions',
      visibilityTimeout: Duration.minutes(5), // 5 minutes for Lambda to process and send
      receiveMessageWaitTime: Duration.seconds(20), // Long polling
      deadLetterQueue: {
        queue: this.submissionDlq,
        maxReceiveCount: 5, // Retry up to 5 times before sending to DLQ
      },
    });

    // SNS topic for SES notifications (bounce, complaint, delivery)
    this.sesNotificationsTopic = new Topic(this, 'SESNotificationsTopic', {
      topicName: 'mailbox-ses-notifications',
      displayName: 'Mailbox SES Notifications',
    });

    // SQS queue to consume SNS notifications
    this.sesNotificationsQueue = new Queue(this, 'SESNotificationsQueue', {
      queueName: 'mailbox-ses-notifications-queue',
      visibilityTimeout: Duration.minutes(5), // 5 minutes - must match Lambda timeout (300 seconds)
      receiveMessageWaitTime: Duration.seconds(20), // Long polling
    });

    // Subscribe the queue to the SNS topic
    this.sesNotificationsTopic.addSubscription(
      new SqsSubscription(this.sesNotificationsQueue, {
        rawMessageDelivery: true, // Deliver the SES notification JSON directly
      })
    );

    // SES Configuration Set for bounce/complaint/delivery notifications
    const cfnConfigSet = new CfnConfigurationSet(this, 'SESConfigurationSet', {
      name: 'mailbox-ses-config',
    });
    this.sesConfigSetName = cfnConfigSet.ref;

    // Add SNS event destination for SES notifications (bounce, complaint, delivery, send, reject)
    new CfnConfigurationSetEventDestination(this, 'SESNotificationDestination', {
      configurationSetName: this.sesConfigSetName,
      eventDestination: {
        snsDestination: {
          topicArn: this.sesNotificationsTopic.topicArn,
        },
        enabled: true,
        matchingEventTypes: [
          'bounce',
          'complaint',
          'delivery',
          'send',
          'reject',
          // Uncomment below if you want to track opens and clicks
          // 'open',
          // 'click',
        ],
      },
    });

    // Email Sender Lambda - processes submissions from SQS and sends via SES
    this.emailSenderLambda = new GoLambda(this, 'EmailSenderLambda', {
      lambdaId: 'email-sender',
      codeProvider: props.codeProvider,
      timeout: Duration.minutes(5), // 5 minutes to fetch from S3 and send via SES
      memorySize: 512,
      environment: {
        EMAIL_BUCKET_NAME: props.emailBucket.bucketName,
        CONFIG_TABLE_NAME: props.configTable.tableName,
        ITEM_TABLE_NAME: props.itemTable.tableName,
        CHANGELOG_TABLE_NAME: props.changelogTable.tableName,
        SES_CONFIG_SET_NAME: this.sesConfigSetName,
      },
    });

    // Grant Lambda permissions
    props.configTable.grantReadData(this.emailSenderLambda);
    props.itemTable.grantReadWriteData(this.emailSenderLambda);
    props.changelogTable.grantReadWriteData(this.emailSenderLambda);
    props.emailBucket.grantRead(this.emailSenderLambda);

    // Add SQS event source to Lambda
    this.emailSenderLambda.addEventSource(
      new SqsEventSource(this.submissionQueue, {
        batchSize: 1, // Process one email at a time
        maxBatchingWindow: Duration.seconds(0), // Process immediately
      })
    );

    // Add SQS event source for SES notifications
    this.emailSenderLambda.addEventSource(
      new SqsEventSource(this.sesNotificationsQueue, {
        batchSize: 1, // Process one notification at a time
        maxBatchingWindow: Duration.seconds(0), // Process immediately
      })
    );

    // Grant SES send permissions (all emails - verified identities will be enforced by SES)
    this.emailSenderLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ses:SendRawEmail'],
        resources: ['*'], // SES enforces verified sender restrictions
      })
    );
  }
}
