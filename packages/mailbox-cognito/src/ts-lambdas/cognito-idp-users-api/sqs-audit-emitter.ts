import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import type { AuditEvent } from '@serverlessinbox/mailbox-admin-api';

export interface AuditEmitter {
  emit(evt: AuditEvent): Promise<void>;
}

export class SqsAuditEmitter implements AuditEmitter {
  private readonly queueUrl: string;
  private readonly sqs: SQSClient;

  constructor(queueUrl: string, opts?: { sqs?: SQSClient }) {
    this.queueUrl = queueUrl;
    this.sqs = opts?.sqs ?? new SQSClient({});
  }

  emit = async (evt: AuditEvent): Promise<void> => {
    const body = this.toAuditWriterBody(evt);
    const messageBody = JSON.stringify(body, (key, value) => {
      if (key === '$typeName') return undefined;
      return typeof value === 'bigint' ? value.toString() : value;
    });

    await this.sqs.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: messageBody }));
  };

  private toAuditWriterBody(evt: AuditEvent): Record<string, unknown> {
    return {
      tenantId: evt.tenantId ?? 'unknown',
      entityType: evt.entityType,
      entityId: evt.entityId,
      entityName: evt.entityName,
      action: evt.action,
      status: evt.status,
      errorMsg: evt.errorMsg,
      actor: evt.actor ?? { actorType: 'system', actorId: 'admin-api', username: 'admin-api' },
      changes: evt.changes,
      metadata: evt.metadata,
    };
  }
}
