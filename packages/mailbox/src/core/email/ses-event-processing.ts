import type { IArtifactResolver }                                   from '@serverlessinbox/artifact-registry-cdk';
import { ComponentDescription, type QueueEncryptionChoice }         from '@serverlessinbox/mailbox-cdk-shared';
import { CfnConfigurationSet, CfnConfigurationSetEventDestination } from 'aws-cdk-lib/aws-ses';
import { Construct }                                                from 'constructs';

import type { IStateChangeFanout, IStateChangeSource }              from '../../contracts/state-change-fanout';
import type { IDataBlobStore }                                      from '../../resources/buckets/data-blob-store';
import { SesEventProcessorLambda }                                  from '../../resources/lambdas/ses-event-processor-lambda';
import type { IAuditEventsQueue }                                   from '../../resources/queues/audit-events-queue';
import { SesEventQueue }                                            from '../../resources/queues/ses-event-queue';
import type { IDataTable }                                          from '../../resources/tables/data-tables';
import { SesEventTopic }                                            from '../../resources/topics/ses-event-topic';

/** Props of {@link SesEventProcessing}. */
export interface SesEventProcessingProps {
  readonly itemTable:         IDataTable;
  readonly changelogTable:    IDataTable;
  readonly mailFeedbackTable: IDataTable;
  readonly configTable:       IDataTable;
  readonly blobStore:         IDataBlobStore;
  readonly auditEventsQueue:  IAuditEventsQueue;
  readonly artifactResolver:  IArtifactResolver;

  /** The encryption of the SES event queue. */
  readonly queueEncryption: QueueEncryptionChoice;
}

/**
 * SES event processing: an SES configuration set publishing bounce, complaint, delivery, send,
 * reject and delivery-delay events to an SNS topic, a queue subscribed to that topic, and the
 * Lambda that consumes the queue.
 */
export class SesEventProcessing extends Construct {
  public readonly sesConfigSetName: string;
  private readonly stateChangeSource: IStateChangeSource;

  constructor(scope: Construct, id: string, props: SesEventProcessingProps) {
    super(scope, id);
    ComponentDescription.describe(this, 'Handles SES delivery, bounce and complaint notifications and records sender feedback.');

    const sesEventTopic = new SesEventTopic(this, 'ses-notifications-topic');

    // A customer-managed key needs a key policy that lets the topic deliver; SesEventQueue adds it.
    const sesEventQueue = new SesEventQueue(this, 'ses-event-queue', {
      topic:      sesEventTopic,
      encryption: props.queueEncryption,
    });

    const cfnConfigSet    = new CfnConfigurationSet(this, 'ses-configuration-set', {});
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

    this.stateChangeSource = new SesEventProcessorLambda(this, 'ses-event-processor', {
      itemTable:         props.itemTable,
      changelogTable:    props.changelogTable,
      mailFeedbackTable: props.mailFeedbackTable,
      configTable:       props.configTable,
      blobStore:         props.blobStore,
      auditEventsQueue:  props.auditEventsQueue,
      sesEventQueue,
      artifactResolver: props.artifactResolver,
    });
  }

  public enableStateChangeFanout(stateChangeFanout: IStateChangeFanout): void {
    this.stateChangeSource.enableStateChangeFanout(stateChangeFanout);
  }
}
