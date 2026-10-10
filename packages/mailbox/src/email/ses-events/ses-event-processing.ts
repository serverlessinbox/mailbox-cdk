import { Construct } from 'constructs';
import { SESEventProcessorLambda } from '../../lambdas';
import type { IDataTable } from '../../data/data-tables';
import { CfnConfigurationSet, CfnConfigurationSetEventDestination } from 'aws-cdk-lib/aws-ses';
import { type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import type { IDataBlobStore } from '../../data/data-blob-store';
import type { IArtifactResolver } from '@serverlessinbox/artifact-registry-cdk';
import { makePhysicalName } from '@serverlessinbox/mailbox-cdk-shared';
import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../../api/websocket/websocket';
import type { IAuditEventsQueue } from '../../features/audit-writing/audit-events-queue';
import { SesEventTopic, type ISesEventTopic } from './ses-event-topic';
import { SesEventQueue, type ISesEventQueue } from './ses-event-queue';

export interface SESEventProcessingProps {
  readonly itemTable: IDataTable;
  readonly changelogTable: IDataTable;
  readonly mailFeedbackTable: IDataTable;
  readonly configTable: IDataTable;
  readonly blobStore: IDataBlobStore;
  readonly auditEventsQueue: IAuditEventsQueue;
  readonly artifactResolver: IArtifactResolver;

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
  /** Read-only identity of the SES-notifications SNS topic; no grant surface (see `ISesEventTopic`). */
  public readonly sesEventTopic: ISesEventTopic;
  /** Consume handle to the SES-notifications queue; grant methods only, no raw SQS object. */
  public readonly sesEventQueue: ISesEventQueue;
  private readonly sesEventProcessorLambda: IWebSocketPushTarget;
  public readonly sesConfigSetName: string;

  constructor(scope: Construct, id: string, props: SESEventProcessingProps) {
    super(scope, id);

    // SNS topic for SES notifications (bounce, complaint, delivery, send, reject)
    const sesEventTopic = new SesEventTopic(this, 'ses-notifications-topic');
    this.sesEventTopic = sesEventTopic;

    // SQS queue to consume SNS notifications. SNS -> SQS does NOT work with SQS queues encrypted
    // using the AWS-managed KMS key (alias/aws/sqs), because SNS can't be granted permission to use
    // that key — `SesEventQueue` defaults to unencrypted unless a customer-managed CMK is supplied.
    const sesEventQueue = new SesEventQueue(this, 'ses-event-queue', {
      topic: sesEventTopic,
      queueProps: props.queueProps,
    });
    this.sesEventQueue = sesEventQueue;

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
          topicArn: this.sesEventTopic.topicArn,
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
      sesEventQueue,
      artifactResolver: props.artifactResolver,
    });

    this.sesEventProcessorLambda = sesEventProcessorLambda;
  }

  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.sesEventProcessorLambda.enableWebSocketPush(broadcaster);
  }
}
