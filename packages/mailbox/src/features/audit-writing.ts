import { Duration } from 'aws-cdk-lib';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { BaseQueue, type BaseQueueProps } from '../utils/base-queue';
import { AuditWriterLambda } from '../lambdas';
import type { ICdkArtifactResolver } from '../artifacts/cdk-artifact-resolver';

export interface AuditWritingProps {
  readonly auditLogTable: ITable;
  readonly artifactResolver: ICdkArtifactResolver;

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
  public readonly auditWriterLambda: lambda.IFunction;

  constructor(scope: Construct, id: string, props: AuditWritingProps) {
    super(scope, id);

    const queueProps = props.queueProps ?? {};

    this.auditEventsDlq = new BaseQueue(this, 'audit-events-dlq', {
      ...queueProps,
      retentionPeriod: Duration.days(14),
    });

    this.auditEventsQueue = new BaseQueue(this, 'audit-events', {
      ...queueProps,
      deadLetterQueue: {
        queue: this.auditEventsDlq,
        maxReceiveCount: 5,
      },
    });

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
