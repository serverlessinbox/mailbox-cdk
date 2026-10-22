import type { IArtifactResolver }                                      from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription, makePhysicalName, type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import { CfnConfigurationSet, CfnConfigurationSetEventDestination }    from 'aws-cdk-lib/aws-ses';
import { Construct }                                                   from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget }     from '../../contracts/websocket-push';
import type { IDataBlobStore }                                         from '../../resources/buckets/data-blob-store';
import { SesEventProcessorLambda }                                     from '../../resources/lambdas/ses-event-processor-lambda';
import type { IAuditEventsQueue }                                      from '../../resources/queues/audit-events-queue';
import { SesEventQueue }                                               from '../../resources/queues/ses-event-queue';
import type { IDataTable }                                             from '../../resources/tables/data-tables';
import { SesEventTopic }                                               from '../../resources/topics/ses-event-topic';

/** Props of {@link SesEventProcessing}. */
export interface SesEventProcessingProps {
  readonly itemTable:         IDataTable;
  readonly changelogTable:    IDataTable;
  readonly mailFeedbackTable: IDataTable;
  readonly configTable:       IDataTable;
  readonly blobStore:         IDataBlobStore;
  readonly auditEventsQueue:  IAuditEventsQueue;
  readonly artifactResolver:  IArtifactResolver;

  /** Optional default props applied to all queues created by this construct (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * SES event processing: an SES configuration set publishing bounce, complaint, delivery, send,
 * reject and delivery-delay events to an SNS topic, a queue subscribed to that topic, and the
 * Lambda that consumes the queue.
 */
export class SesEventProcessing extends Construct {
  public readonly sesConfigSetName: string;
  private readonly sesEventProcessorLambda: IWebSocketPushTarget;

  constructor(scope: Construct, id: string, props: SesEventProcessingProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Handles SES delivery, bounce and complaint notifications and records sender feedback.');

    const sesEventTopic = new SesEventTopic(this, 'ses-notifications-topic');

    // SNS cannot be granted use of the AWS-managed SQS key (alias/aws/sqs), so a queue encrypted
    // with it never receives the topic's messages.
    const sesEventQueue = new SesEventQueue(this, 'ses-event-queue', {
      topic:      sesEventTopic,
      queueProps: props.queueProps,
    });

    const cfnConfigSet    = new CfnConfigurationSet(this, 'ses-configuration-set', {
      name: makePhysicalName(this, 'ses-config', { maxLength: 64 }),
    });
    this.sesConfigSetName = cfnConfigSet.ref;

    new CfnConfigurationSetEventDestination(this, 'ses-notification-destination', {
      configurationSetName: this.sesConfigSetName,
      eventDestination:     {
        snsDestination:     {
          topicArn: sesEventTopic.topicArn,
        },
        enabled:            true,
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

    this.sesEventProcessorLambda = new SesEventProcessorLambda(this, 'ses-event-processor', {
      itemTable:         props.itemTable,
      changelogTable:    props.changelogTable,
      mailFeedbackTable: props.mailFeedbackTable,
      configTable:       props.configTable,
      blobStore:         props.blobStore,
      auditEventsQueue:  props.auditEventsQueue,
      sesEventQueue,
      artifactResolver:  props.artifactResolver,
    });
  }

  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.sesEventProcessorLambda.enableWebSocketPush(broadcaster);
  }
}
