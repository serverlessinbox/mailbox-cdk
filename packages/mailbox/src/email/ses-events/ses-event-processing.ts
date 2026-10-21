import type { IArtifactResolver }                                   from '@serverlessinbox/artifact-registry-cdk';
import { makePhysicalName, type BaseQueueProps }                    from '@serverlessinbox/mailbox-cdk-shared';
import { CfnConfigurationSet, CfnConfigurationSetEventDestination } from 'aws-cdk-lib/aws-ses';
import { Construct }                                                from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget }  from '../../api/websocket/websocket';
import type { IDataBlobStore }                                      from '../../data/data-blob-store';
import type { IDataTable }                                          from '../../data/data-tables';
import type { IAuditEventsQueue }                                   from '../../features/audit-writing/audit-events-queue';
import { SESEventProcessorLambda }                                  from '../../resources/lambdas/ses-event-processor-lambda';

import { SesEventQueue, type ISesEventQueue }                       from './ses-event-queue';
import { SesEventTopic, type ISesEventTopic }                       from './ses-event-topic';

/** Props of {@link SESEventProcessing}. */
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
 * SES event processing: an SES configuration set publishing bounce, complaint, delivery, send,
 * reject and delivery-delay events to an SNS topic, a queue subscribed to that topic, and the
 * Lambda that consumes the queue.
 */
export class SESEventProcessing extends Construct {
  /** Read-only identity of the SES-notifications SNS topic; no grant surface (see `ISesEventTopic`). */
  public readonly sesEventTopic: ISesEventTopic;
  /** Consume handle to the SES-notifications queue; grant methods only, no raw SQS object. */
  public readonly sesEventQueue: ISesEventQueue;
  public readonly sesConfigSetName: string;
  private readonly sesEventProcessorLambda: IWebSocketPushTarget;

  constructor(scope: Construct, id: string, props: SESEventProcessingProps) {
    super(scope, id);

    const sesEventTopic = new SesEventTopic(this, 'ses-notifications-topic');
    this.sesEventTopic  = sesEventTopic;

    // SNS cannot be granted use of the AWS-managed SQS key (alias/aws/sqs), so a queue encrypted
    // with it never receives the topic's messages.
    const sesEventQueue = new SesEventQueue(this, 'ses-event-queue', {
      topic: sesEventTopic,
      queueProps: props.queueProps,
    });
    this.sesEventQueue  = sesEventQueue;

    const cfnConfigSet    = new CfnConfigurationSet(this, 'ses-configuration-set', {
      name: makePhysicalName(this, 'ses-config', { maxLength: 64 }),
    });
    this.sesConfigSetName = cfnConfigSet.ref;

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
        ],
      },
    });

    this.sesEventProcessorLambda = new SESEventProcessorLambda(this, 'ses-event-processor', {
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      mailFeedbackTable: props.mailFeedbackTable,
      configTable: props.configTable,
      blobStore: props.blobStore,
      auditEventsQueue: props.auditEventsQueue,
      sesEventQueue,
      artifactResolver: props.artifactResolver,
    });
  }

  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.sesEventProcessorLambda.enableWebSocketPush(broadcaster);
  }
}
