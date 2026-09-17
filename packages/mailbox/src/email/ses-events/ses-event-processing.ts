import { Duration } from 'aws-cdk-lib';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { SESEventProcessorLambda } from '../../lambdas';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { CfnConfigurationSet, CfnConfigurationSetEventDestination } from 'aws-cdk-lib/aws-ses';
import { BaseQueue, type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { makePhysicalName } from '@serverlessinbox/mailbox-cdk-shared';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../../api/websocket/websocket';
import { SesEventTopic, type ISesEventTopic } from './ses-event-topic';
import { SesEventQueue, type ISesEventQueue } from './ses-event-queue';

export interface SESEventProcessingProps {
  readonly itemTable: ITable;
  readonly changelogTable: ITable;
  readonly mailFeedbackTable: ITable;
  readonly configTable: ITable;
  readonly blobStore: IBucket;
  readonly auditEventsQueue: IQueue;
  readonly artifactResolver: ICdkArtifactEngine;

  /** Optional default props applied to all queues created by this construct (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
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
  public readonly sesEventTopicAccess: ISesEventTopic;
  public readonly sesEventQueueAccess: ISesEventQueue;
  private readonly sesEventProcessorLambda: IWebSocketPushTarget;
  public readonly sesConfigSetName: string;

  constructor(scope: Construct, id: string, props: SESEventProcessingProps) {
    super(scope, id);

    // SNS topic for SES notifications (bounce, complaint, delivery, send, reject)
    const sesEventTopic = new SesEventTopic(this, 'ses-notifications-topic');
    this.sesEventTopicAccess = sesEventTopic;
    this.sesNotificationsTopic = sesEventTopic;

    // SQS queue to consume SNS notifications. SNS -> SQS does NOT work with SQS queues encrypted
    // using the AWS-managed KMS key (alias/aws/sqs), because SNS can't be granted permission to use
    // that key — `SesEventQueue` defaults to unencrypted unless a customer-managed CMK is supplied.
    const sesEventQueue = new SesEventQueue(this, 'ses-event-queue', {
      topic: sesEventTopic,
      queueProps: props.queueProps,
    });
    this.sesEventQueueAccess = sesEventQueue;
    this.sesNotificationsQueue = sesEventQueue.queue;

    // SES Configuration Set for bounce/complaint/delivery notifications
    const cfnConfigSet = new CfnConfigurationSet(this, 'ses-configuration-set', {
      name: makePhysicalName(this, 'ses-config', { maxLength: 64 }),
    });
    this.sesConfigSetName = cfnConfigSet.ref;

    // Add SNS event destination for SES notifications (bounce, complaint, delivery, send, reject)
    new CfnConfigurationSetEventDestination(this, 'ses-notification-destination', {
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
    const sesEventProcessorLambda = new SESEventProcessorLambda(this, 'ses-event-processor', {
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      mailFeedbackTable: props.mailFeedbackTable,
      configTable: props.configTable,
      blobStore: props.blobStore,
      auditEventsQueue: props.auditEventsQueue,
      artifactResolver: props.artifactResolver,
    });

    // Add SQS event source for SES notifications
    sesEventProcessorLambda.addEventSource(
      new SqsEventSource(this.sesNotificationsQueue, {
        batchSize: 100,
        maxConcurrency: 5,
        reportBatchItemFailures: true,
        maxBatchingWindow: Duration.seconds(30),
      })
    );

    this.sesEventProcessorLambda = sesEventProcessorLambda;
  }

  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.sesEventProcessorLambda.enableWebSocketPush(broadcaster);
  }
}
