import { Duration } from 'aws-cdk-lib';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SqsSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { SESEventProcessorLambda } from '../lambdas';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { CfnConfigurationSet, CfnConfigurationSetEventDestination } from 'aws-cdk-lib/aws-ses';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { BaseQueue, type BaseQueueProps } from '../utils/base-queue';
import { IQueue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IArtifactResolver } from '../artifacts/artifact-resolver';
import { makePhysicalName } from '../utils/resource-names';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';

export interface SESEventProcessingProps {
  itemTable: ITable;
  changelogTable: ITable;
  mailFeedbackTable: ITable;
  configTable: ITable;
  emailBucket: IBucket;
  auditEventsQueue: IQueue;
  artifactResolver: IArtifactResolver;

  /** Optional default props applied to all queues created by this construct (e.g. encryption). */
  queueProps?: Partial<BaseQueueProps>;
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

    const queueProps = props.queueProps ?? {};

    // SNS topic for SES notifications (bounce, complaint, delivery, send, reject)
    this.sesNotificationsTopic = new Topic(this, 'ses-notifications-topic', {
      displayName: 'Mailbox SES Notifications',
    });

    // SQS queue to consume SNS notifications
    // NOTE: SNS -> SQS does NOT work with SQS queues encrypted using the AWS-managed KMS key (alias/aws/sqs),
    // because we can't grant SNS permission to use that key.
    // Default to UNENCRYPTED for this specific queue unless the user supplies a customer-managed CMK.
    const sesNotificationsQueueEncryption = queueProps.encryption
      ?? (queueProps.encryptionMasterKey ? QueueEncryption.KMS : QueueEncryption.UNENCRYPTED);

    this.sesNotificationsQueue = new BaseQueue(this, 'ses-notifications-queue', {
      ...queueProps,
      encryption: sesNotificationsQueueEncryption,
    });

    // Subscribe the queue to the SNS topic
    this.sesNotificationsTopic.addSubscription(
      new SqsSubscription(this.sesNotificationsQueue, {
        rawMessageDelivery: true, // Deliver the SES notification JSON directly
      })
    );

    // If the queue is encrypted with a customer-managed CMK, allow SNS to use the key.
    // (Imported keys may not support policy edits; in that case the user must configure the key policy themselves.)
    const keyAny = queueProps.encryptionMasterKey as unknown as { addToResourcePolicy?: (s: PolicyStatement) => unknown };
    if (sesNotificationsQueueEncryption === QueueEncryption.KMS && queueProps.encryptionMasterKey && typeof keyAny?.addToResourcePolicy === 'function') {
      keyAny.addToResourcePolicy(
        new PolicyStatement({
          actions: [
            'kms:Decrypt',
            'kms:Encrypt',
            'kms:ReEncrypt*',
            'kms:GenerateDataKey*',
            'kms:DescribeKey',
          ],
          principals: [new ServicePrincipal('sns.amazonaws.com')],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'aws:SourceAccount': Stack.of(this).account,
            },
            ArnEquals: {
              'aws:SourceArn': this.sesNotificationsTopic.topicArn,
            },
          },
        })
      );
    }

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
    this.sesEventProcessorLambda = new SESEventProcessorLambda(this, 'ses-event-processor', {
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
