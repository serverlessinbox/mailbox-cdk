import { Duration } from 'aws-cdk-lib';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SqsSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { SESEventProcessorLambda } from '../lambdas';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { CfnConfigurationSet, CfnConfigurationSetEventDestination } from 'aws-cdk-lib/aws-ses';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { BaseQueue } from '../utils/base-queue';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IArtifactResolver } from '../utils/artifact-resolver';

export interface SESEventProcessingProps {
  itemTable: ITable;
  changelogTable: ITable;
  mailFeedbackTable: ITable;
  configTable: ITable;
  emailBucket: IBucket;
  auditEventsQueue: IQueue;
  artifactResolver: IArtifactResolver;
}

/**
 * SES Event Processing Infrastructure
 * 
 * Handles SES events (bounce, complaint, delivery, send, reject) through:
 * - SNS topic for SES notifications
 * - SQS queue to consume SNS notifications
 * - Lambda to process SES events
 * - SES Configuration Set for event routing
 */
export class SESEventProcessing extends Construct {
  public readonly sesNotificationsTopic: Topic;
  public readonly sesNotificationsQueue: BaseQueue;
  public readonly sesEventProcessorLambda: lambda.IFunction;
  public readonly sesConfigSetName: string;

  constructor(scope: Construct, id: string, props: SESEventProcessingProps) {
    super(scope, id);

    // SNS topic for SES notifications (bounce, complaint, delivery, send, reject)
    this.sesNotificationsTopic = new Topic(this, 'SESNotificationsTopic', {
      topicName: 'mailbox-ses-notifications',
      displayName: 'Mailbox SES Notifications',
    });

    // SQS queue to consume SNS notifications
    this.sesNotificationsQueue = new BaseQueue(this, 'SESNotificationsQueue', {
      queueName: 'mailbox-ses-notifications-queue',
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
          'DELIVERY_DELAY',         
          // Uncomment below if you want to track opens and clicks
          // 'open',
          // 'click',
        ],
      },
    });

    // SES Event Processor Lambda - processes SES notifications from SQS
    this.sesEventProcessorLambda = new SESEventProcessorLambda(this, 'SESEventProcessorLambda', {
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      mailFeedbackTable: props.mailFeedbackTable,
      configTable: props.configTable,
      emailBucket: props.emailBucket,
      auditEventsQueue: props.auditEventsQueue,
      artifactResolver: props.artifactResolver,
    });

    // Add SQS event source for SES notifications
    this.sesEventProcessorLambda.addEventSource(
      new SqsEventSource(this.sesNotificationsQueue, {
        batchSize: 100,
        maxConcurrency: 5,
        reportBatchItemFailures: true,
        maxBatchingWindow: Duration.seconds(30),
      })
    );
  }
}
