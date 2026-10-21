import type { IArtifactResolver }                                  from '@serverlessinbox/artifact-registry-cdk';
import type { BaseQueueProps }                                     from '@serverlessinbox/mailbox-cdk-shared';
import { Construct }                                               from 'constructs';

import type { IWebSocketBroadcastPublisher, IWebSocketPushTarget } from '../apis/websocket';
import type { IDataBlobStore }                                     from '../../resources/buckets/data-blob-store';
import type { IDataTable }                                         from '../../resources/tables/data-tables';
import { EmailSenderLambda }                                       from '../../resources/lambdas/email-sender-lambda';

import { EmailSendingQueue, type IEmailSendingQueue }              from '../../resources/queues/email-sending-queue';

/** Props of {@link EmailSending}. */
export interface EmailSendingProps {
  readonly configTable: IDataTable;
  readonly itemTable: IDataTable;
  readonly changelogTable: IDataTable;
  readonly blobStore: IDataBlobStore;
  readonly artifactResolver: IArtifactResolver;
  readonly sesConfigSetName: string;

  /** Optional default props applied to all queues created by this construct (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Outbound email path: the email-submissions queue and the `email-sender` Lambda that drains it and
 * sends through SES.
 *
 * Not responsible for processing SES delivery events.
 */
export class EmailSending extends Construct {
  /** Send access to the email-submissions queue; grant methods only, no raw SQS object. */
  public readonly submissionQueue: IEmailSendingQueue;
  private readonly emailSenderLambda: IWebSocketPushTarget;

  constructor(scope: Construct, id: string, props: EmailSendingProps) {
    super(scope, id);

    const submissionQueue = new EmailSendingQueue(this, 'email-submissions-queue', {
      queueProps: props.queueProps,
    });
    this.submissionQueue  = submissionQueue;

    this.emailSenderLambda = new EmailSenderLambda(this, 'email-sender', {
      configTable: props.configTable,
      itemTable: props.itemTable,
      changelogTable: props.changelogTable,
      blobStore: props.blobStore,
      sesConfigSetName: props.sesConfigSetName,
      submissionQueue,
      artifactResolver: props.artifactResolver,
    });
  }

  public enableWebSocketPublishing(broadcaster: IWebSocketBroadcastPublisher): void {
    this.emailSenderLambda.enableWebSocketPush(broadcaster);
  }
}
