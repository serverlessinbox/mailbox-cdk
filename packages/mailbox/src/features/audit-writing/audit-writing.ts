import { Duration } from 'aws-cdk-lib';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { BaseQueue, type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
import { AuditWriterLambda } from '../../lambdas';
import type { ICdkArtifactEngine } from '@serverlessinbox/mailbox-cdk-shared';
import { AuditEventsQueue, type IAuditEventsQueue } from './audit-events-queue';

export interface AuditWritingProps {
  readonly auditLogTable: ITable;
  readonly artifactResolver: ICdkArtifactEngine;

  /** Optional default props applied to all queues created by this construct (e.g. encryption). */
  readonly queueProps?: Partial<BaseQueueProps>;
}

/**
 * Audit Writing Infrastructure
 *
 * Creates an SQS queue for audit events and a consumer Lambda (audit-writer).
 */
export class AuditWriting extends Construct {
  public readonly auditEventsQueue: BaseQueue;
  public readonly auditEventsDlq: BaseQueue;
  public readonly auditEventsQueueAccess: IAuditEventsQueue;
  public readonly auditWriterLambda: lambda.IFunction;

  constructor(scope: Construct, id: string, props: AuditWritingProps) {
    super(scope, id);

    const auditEventsQueue = new AuditEventsQueue(this, 'audit-events-queue', {
      queueProps: props.queueProps,
    });
    this.auditEventsQueueAccess = auditEventsQueue;
    this.auditEventsDlq = auditEventsQueue.dlq;
    this.auditEventsQueue = auditEventsQueue.queue;

    this.auditWriterLambda = new AuditWriterLambda(this, 'audit-writer', {
      auditLogTable: props.auditLogTable,
      artifactResolver: props.artifactResolver,
    });

    this.auditWriterLambda.addEventSource(
      new SqsEventSource(this.auditEventsQueue, {
        batchSize: 100,
        maxBatchingWindow: Duration.seconds(30),
        reportBatchItemFailures: true,
      })
    );
  }
}
