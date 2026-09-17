import { Construct } from 'constructs';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { type BaseQueueProps } from '@serverlessinbox/mailbox-cdk-shared';
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
  /** Send-only handle to the audit-events queue; grant methods only, no raw SQS object. */
  public readonly auditEventsQueue: IAuditEventsQueue;
  public readonly auditWriterLambda: lambda.IFunction;

  constructor(scope: Construct, id: string, props: AuditWritingProps) {
    super(scope, id);

    const auditEventsQueue = new AuditEventsQueue(this, 'audit-events-queue', {
      queueProps: props.queueProps,
    });
    this.auditEventsQueue = auditEventsQueue;

    this.auditWriterLambda = new AuditWriterLambda(this, 'audit-writer', {
      auditLogTable: props.auditLogTable,
      auditEventsQueue,
      artifactResolver: props.artifactResolver,
    });
  }
}
