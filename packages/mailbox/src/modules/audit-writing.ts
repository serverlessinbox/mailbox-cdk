import { Duration } from 'aws-cdk-lib';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { BaseQueue } from '../utils/base-queue';
import { AuditWriterLambda } from '../lambdas';
import { IArtifactResolver } from '../utils/artifact-resolver';

export interface AuditWritingProps {
  auditLogTable: ITable;
  artifactResolver: IArtifactResolver;
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

    this.auditEventsDlq = new BaseQueue(this, 'audit-events-dlq', {
      retentionPeriod: Duration.days(14),
    });

    this.auditEventsQueue = new BaseQueue(this, 'audit-events', {
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
