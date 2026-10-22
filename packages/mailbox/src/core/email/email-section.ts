import type { IArtifactResolver }                                  from '@serverlessinbox/artifact-registry-cdk';
import type { BaseQueueProps }                                     from '@serverlessinbox/mailbox-cdk-shared';
import { applyServerlessInboxComponentTag }                        from '@serverlessinbox/mailbox-cdk-shared';
import type { IBucket }                                            from 'aws-cdk-lib/aws-s3';
import type { IReceiptRuleSet }                                    from 'aws-cdk-lib/aws-ses';
import { Construct }                                               from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../../contracts/websocket-push';
import type { IDataBlobStore }                                     from '../../resources/buckets/data-blob-store';
import { EmailProcessorLambda }                                    from '../../resources/lambdas/email-processor-lambda';
import type { IAuditEventsQueue }                                  from '../../resources/queues/audit-events-queue';
import type { IEmailSendingQueue }                                 from '../../resources/queues/email-sending-queue';
import type { IDataTable }                                         from '../../resources/tables/data-tables';

import { EmailSending }                                            from './email-sending';
import { SesEventProcessing }                                      from './ses-event-processing';
import { SesRules }                                                from './ses-rules';

/** What {@link EmailSection} uses of the data section. */
export interface IEmailDataInputs {
  readonly configTable:       IDataTable;
  readonly itemTable:         IDataTable;
  readonly changelogTable:    IDataTable;
  readonly mailFeedbackTable: IDataTable;
  readonly blobStore:         IDataBlobStore;
  /** The raw bucket the SES receipt rules deliver into. */
  readonly blobStoreBucket:  IBucket;
  readonly auditEventsQueue: IAuditEventsQueue;
}

/** Props of {@link EmailSection}. */
export interface EmailSectionProps {
  readonly artifactResolver: IArtifactResolver;
  readonly data:             IEmailDataInputs;
  readonly queueProps?:      Partial<BaseQueueProps>;
}

/** Email receiving, sending and SES event processing. */
export class EmailSection extends Construct {
  public readonly sesConfigSetName: string;
  public readonly sesRuleSetName: string;
  public readonly sesRuleSet: IReceiptRuleSet;
  public readonly submissionQueue: IEmailSendingQueue;

  private readonly sesEventProcessing: SesEventProcessing;
  private readonly emailSending: EmailSending;
  private readonly emailProcessorLambda: IWebSocketPushTarget;

  constructor(scope: Construct, id: string, props: EmailSectionProps) {
    super(scope, id);
    applyServerlessInboxComponentTag(this, 'email');

    const { data } = props;

    this.sesEventProcessing = new SesEventProcessing(this, 'ses-event-processing', {
      itemTable:         data.itemTable,
      mailFeedbackTable: data.mailFeedbackTable,
      changelogTable:    data.changelogTable,
      configTable:       data.configTable,
      blobStore:         data.blobStore,
      auditEventsQueue:  data.auditEventsQueue,
      artifactResolver:  props.artifactResolver,
      queueProps:        props.queueProps,
    });

    this.emailSending = new EmailSending(this, 'email-sending', {
      configTable:      data.configTable,
      itemTable:        data.itemTable,
      changelogTable:   data.changelogTable,
      blobStore:        data.blobStore,
      artifactResolver: props.artifactResolver,
      sesConfigSetName: this.sesEventProcessing.sesConfigSetName,
      queueProps:       props.queueProps,
    });

    // SES receipt rules and the email-processing queue they feed. Built before the email-processor
    // Lambda so its own event source mapping can reference the queue at construction time.
    const sesRules = new SesRules(this, 'ses-rules', {
      blobStoreBucket:  data.blobStoreBucket,
      artifactResolver: props.artifactResolver,
      queueProps:       props.queueProps,
    });

    this.emailProcessorLambda = new EmailProcessorLambda(this, 'email-processor-lambda', {
      configTable:          data.configTable,
      itemTable:            data.itemTable,
      changelogTable:       data.changelogTable,
      blobStore:            data.blobStore,
      emailProcessingQueue: sesRules.emailProcessingQueue,
      artifactResolver:     props.artifactResolver,
    });

    this.sesConfigSetName = this.sesEventProcessing.sesConfigSetName;
    this.sesRuleSetName   = sesRules.ruleSetName;
    this.sesRuleSet       = sesRules.ruleSet;
    this.submissionQueue  = this.emailSending.submissionQueue;
  }

  /** Enables WebSocket push emission from the ChangeTracker in each Lambda that records changelog state. */
  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.emailProcessorLambda.enableWebSocketPush(broadcaster);
    this.emailSending.enableWebSocketPublishing(broadcaster);
    this.sesEventProcessing.enableWebSocketPublishing(broadcaster);
  }
}
